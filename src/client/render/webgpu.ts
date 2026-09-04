import type { Rect } from '../board'
import type { View } from '../camera'
import { mipLevelCount, packUniforms, UNIFORM_FLOATS, type Overlay, type Renderer } from './renderer'

// Keep in step with the GLSL in webgl2.ts.
const MAIN = /* wgsl */ `
struct U {
  viewport: vec2f, canvasSize: vec2f,
  center: vec2f, zoom: f32, gridAlpha: f32,
  hover: vec2f, selected: vec2f,
  previewColor: vec3f, previewAlpha: f32,
  pop: vec2f, popT: f32, pad: f32,
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tex: texture_2d<f32>;

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  return vec4f(p[i], 0, 1);
}

@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let fc = pos.xy; // origin top-left, y down
  let p = (fc - u.viewport * 0.5) / u.zoom + u.center;
  let tex3 = textureSample(tex, samp, p / u.canvasSize).rgb;
  let inside = step(0.0, p.x) * step(0.0, p.y) * step(p.x, u.canvasSize.x - 1e-4) * step(p.y, u.canvasSize.y - 1e-4);
  var c = tex3;
  let f = fract(p);
  let cell = floor(p);
  let edge = min(f, 1.0 - f) * u.zoom;
  let minEdge = min(edge.x, edge.y);
  if (u.gridAlpha > 0.0) {
    let g = 1.0 - smoothstep(0.35, 0.85, minEdge);
    c = mix(c, vec3f(0.0), g * u.gridAlpha * 0.35);
  }
  let onSel = u.selected.x >= 0.0 && all(cell == u.selected);
  let onHover = u.hover.x >= 0.0 && all(cell == u.hover);
  if ((onSel || onHover) && u.previewAlpha > 0.0) { c = mix(c, u.previewColor, u.previewAlpha); }
  if (onHover && !onSel) {
    let lum = dot(c, vec3f(0.299, 0.587, 0.114));
    let ring = select(vec3f(1.0), vec3f(0.0), lum > 0.5);
    c = mix(c, ring, (1.0 - smoothstep(1.0, 2.0, minEdge)) * 0.85);
  }
  if (onSel) {
    let local = f * u.zoom;
    let fromCorner = min(local, vec2f(u.zoom) - local);
    let L = max(5.0, u.zoom * 0.28);
    let T = 2.0;
    let rim = (edge.y < T + 1.0 && fromCorner.x < L + 1.0) || (edge.x < T + 1.0 && fromCorner.y < L + 1.0);
    let ink = (edge.y < T && fromCorner.x < L) || (edge.x < T && fromCorner.y < L);
    if (rim) { c = vec3f(0.0); }
    if (ink) { c = vec3f(1.0); }
  }
  if (u.popT >= 0.0) {
    let dist = length((p - (u.pop + 0.5)) * u.zoom);
    let r = 4.0 + u.popT * 110.0;
    let a = 1.0 - u.popT / 0.4;
    let ring = 1.0 - smoothstep(0.0, 3.0, abs(dist - r));
    c = mix(c, mix(u.previewColor, vec3f(1.0), 0.5), ring * a * 0.9);
  }
  let dOut = max(max(-p, p - u.canvasSize), vec2f(0.0)) * u.zoom;
  let frame = 1.0 - step(6.0, max(dOut.x, dOut.y));
  let bg = mix(vec3f(0.2), vec3f(0.314), frame);
  return vec4f(mix(bg, c, inside), 1.0);
}`

// Downsample level N-1 into level N with a linear sample at each destination texel center.
const MIP = /* wgsl */ `
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var src: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  return vec4f(p[i], 0, 1);
}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let dst = max(vec2u(1u), textureDimensions(src) / 2u);
  return textureSample(src, samp, pos.xy / vec2f(dst));
}`

/** allowSoftware: accept a fallback (software) adapter, e.g. SwiftShader. Only for testing. */
export async function createWebGPU(canvas: HTMLCanvasElement, W: number, H: number, allowSoftware = false): Promise<Renderer | null> {
  if (!navigator.gpu) return null
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
  if (!adapter) return null
  const info = adapter.info as (GPUAdapterInfo & { isFallbackAdapter?: boolean }) | undefined
  const software = info?.isFallbackAdapter || (adapter as unknown as { isFallbackAdapter?: boolean }).isFallbackAdapter
  if (software && !allowSoftware) { console.info('[render] WebGPU adapter is software-only, using WebGL2'); return null }
  console.info(`[render] WebGPU adapter: ${info?.vendor ?? '?'} ${info?.architecture ?? ''} ${info?.description ?? ''}${software ? ' (software)' : ''}`.trim())
  const device = await adapter.requestDevice()
  device.addEventListener('uncapturederror', (e) => console.error('[webgpu]', (e as GPUUncapturedErrorEvent).error.message))
  const ctx = canvas.getContext('webgpu')
  if (!ctx) { device.destroy(); return null }
  const format = navigator.gpu.getPreferredCanvasFormat()
  ctx.configure({ device, format, alphaMode: 'opaque' })

  const levels = mipLevelCount(W, H)
  const texture = device.createTexture({
    size: [W, H], format: 'rgba8unorm', mipLevelCount: levels,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  })
  const sampler = device.createSampler({ magFilter: 'nearest', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' })
  const linear = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  const ubuf = device.createBuffer({ size: UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const uniforms = new Float32Array(UNIFORM_FLOATS)

  const mainModule = device.createShaderModule({ code: MAIN })
  const mainPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: mainModule, entryPoint: 'vs' },
    fragment: { module: mainModule, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  })
  const mainBind = device.createBindGroup({
    layout: mainPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: ubuf } },
      { binding: 1, resource: sampler },
      { binding: 2, resource: texture.createView() },
    ],
  })

  const mipModule = device.createShaderModule({ code: MIP })
  const mipPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: mipModule, entryPoint: 'vs' },
    fragment: { module: mipModule, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
    primitive: { topology: 'triangle-list' },
  })
  const levelViews = Array.from({ length: levels }, (_, l) => texture.createView({ baseMipLevel: l, mipLevelCount: 1 }))
  const mipBinds = levelViews.slice(0, -1).map((v) => device.createBindGroup({
    layout: mipPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: linear }, { binding: 1, resource: v }],
  }))

  let mipDirty: { x0: number; y0: number; x1: number; y1: number } | null = null

  const regenMips = (enc: GPUCommandEncoder, d: { x0: number; y0: number; x1: number; y1: number }) => {
    let { x0, y0, x1, y1 } = d
    for (let l = 1; l < levels; l++) {
      const lw = Math.max(1, W >> l)
      const lh = Math.max(1, H >> l)
      x0 = Math.max(0, (x0 >> 1) - 1)
      y0 = Math.max(0, (y0 >> 1) - 1)
      x1 = Math.min(lw, ((x1 + 1) >> 1) + 1)
      y1 = Math.min(lh, ((y1 + 1) >> 1) + 1)
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: levelViews[l]!, loadOp: 'load', storeOp: 'store' }] })
      pass.setPipeline(mipPipeline)
      pass.setBindGroup(0, mipBinds[l - 1]!)
      pass.setScissorRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0))
      pass.draw(3)
      pass.end()
    }
  }

  const r: Renderer = {
    name: 'webgpu',
    onLost: null,
    resize(w, h) {
      canvas.width = w
      canvas.height = h
    },
    upload(rect: Rect, rgba: Uint8Array<ArrayBuffer>) {
      device.queue.writeTexture(
        { texture, origin: { x: rect.x, y: rect.y } },
        rgba,
        { offset: (rect.y * W + rect.x) * 4, bytesPerRow: W * 4, rowsPerImage: rect.h },
        { width: rect.w, height: rect.h },
      )
      const x1 = rect.x + rect.w, y1 = rect.y + rect.h
      if (!mipDirty) mipDirty = { x0: rect.x, y0: rect.y, x1, y1 }
      else {
        mipDirty.x0 = Math.min(mipDirty.x0, rect.x); mipDirty.y0 = Math.min(mipDirty.y0, rect.y)
        mipDirty.x1 = Math.max(mipDirty.x1, x1); mipDirty.y1 = Math.max(mipDirty.y1, y1)
      }
    },
    draw(view: View, overlay: Overlay) {
      packUniforms(uniforms, view, overlay, W, H)
      device.queue.writeBuffer(ubuf, 0, uniforms)
      const enc = device.createCommandEncoder()
      if (mipDirty) {
        regenMips(enc, mipDirty)
        mipDirty = null
      }
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
      })
      pass.setPipeline(mainPipeline)
      pass.setBindGroup(0, mainBind)
      pass.draw(3)
      pass.end()
      device.queue.submit([enc.finish()])
    },
    async readPixel(x, y) {
      const target = device.createTexture({ size: [canvas.width, canvas.height], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })
      const buf = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      const enc = device.createCommandEncoder()
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] })
      pass.setPipeline(mainPipeline)
      pass.setBindGroup(0, mainBind)
      pass.draw(3)
      pass.end()
      enc.copyTextureToBuffer({ texture: target, origin: { x, y } }, { buffer: buf, bytesPerRow: 256 }, { width: 1, height: 1 })
      device.queue.submit([enc.finish()])
      await buf.mapAsync(GPUMapMode.READ)
      const d = new Uint8Array(buf.getMappedRange().slice(0, 4))
      buf.unmap()
      buf.destroy()
      target.destroy()
      return format === 'bgra8unorm' ? [d[2]!, d[1]!, d[0]!] : [d[0]!, d[1]!, d[2]!]
    },
    destroy() {
      texture.destroy()
      ubuf.destroy()
      device.destroy()
    },
  }
  device.lost.then((info) => {
    if (info.reason !== 'destroyed') r.onLost?.()
  })
  return r
}
