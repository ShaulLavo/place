import type { Rect } from '../board'
import type { View } from '../camera'
import { mipLevelCount, packUniforms, UNIFORM_FLOATS, type Overlay, type Renderer } from './renderer'

const VS = `#version 300 es
void main() {
  // Full-screen triangle from gl_VertexID; no buffers.
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  gl_Position = vec4(p, 0.0, 1.0);
}`

// Keep in step with the WGSL in webgpu.ts.
const FS = `#version 300 es
precision highp float;
uniform vec4 u0; // viewport.xy, canvasSize.xy
uniform vec4 u1; // center.xy, zoom, gridAlpha
uniform vec4 u2; // hover.xy, selected.xy
uniform vec4 u3; // previewColor.rgb, previewAlpha
uniform vec4 u4; // pop.xy, popT (<0 none), unused
uniform sampler2D uTex;
out vec4 outColor;
void main() {
  vec2 viewport = u0.xy, canvasSize = u0.zw, center = u1.xy;
  float zoom = u1.z, gridAlpha = u1.w;
  vec2 fc = vec2(gl_FragCoord.x, viewport.y - gl_FragCoord.y);
  vec2 p = (fc - viewport * 0.5) / zoom + center;
  // Sample unconditionally so derivatives (mip selection) stay well defined.
  vec3 tex = texture(uTex, p / canvasSize).rgb;
  float inside = step(0.0, p.x) * step(0.0, p.y) * step(p.x, canvasSize.x - 1e-4) * step(p.y, canvasSize.y - 1e-4);
  vec3 c = tex;
  vec2 f = fract(p);
  vec2 cell = floor(p);
  vec2 edge = min(f, 1.0 - f) * zoom; // device px to the nearest cell edge
  float minEdge = min(edge.x, edge.y);
  if (gridAlpha > 0.0) {
    // Anti-aliased 1-device-px line centered on each cell edge, so no line is thicker than another.
    float g = 1.0 - smoothstep(0.35, 0.85, minEdge);
    c = mix(c, vec3(0.0), g * gridAlpha * 0.35);
  }
  bool onSel = u2.z >= 0.0 && cell == u2.zw;
  bool onHover = u2.x >= 0.0 && cell == u2.xy;
  // Preview the chosen color inside the picked pixel and under the pointer.
  if ((onSel || onHover) && u3.a > 0.0) c = mix(c, u3.rgb, u3.a);
  if (onHover && !onSel) {
    float lum = dot(c, vec3(0.299, 0.587, 0.114));
    vec3 ring = lum > 0.5 ? vec3(0.0) : vec3(1.0);
    c = mix(c, ring, (1.0 - smoothstep(1.0, 2.0, minEdge)) * 0.85);
  }
  if (onSel) {
    // Corner-bracket reticle: white brackets with a dark rim.
    vec2 local = f * zoom;
    vec2 fromCorner = min(local, zoom - local);
    float L = max(5.0, zoom * 0.28);
    float T = 2.0;
    bool rim = (edge.y < T + 1.0 && fromCorner.x < L + 1.0) || (edge.x < T + 1.0 && fromCorner.y < L + 1.0);
    bool ink = (edge.y < T && fromCorner.x < L) || (edge.x < T && fromCorner.y < L);
    if (rim) c = vec3(0.0);
    if (ink) c = vec3(1.0);
  }
  if (u4.z >= 0.0) {
    // Placement pop: a ring expanding from the placed pixel.
    float dist = length((p - (u4.xy + 0.5)) * zoom);
    float r = 4.0 + u4.z * 110.0;
    float a = 1.0 - u4.z / 0.4;
    float ring = 1.0 - smoothstep(0.0, 3.0, abs(dist - r));
    c = mix(c, mix(u3.rgb, vec3(1.0), 0.5), ring * a * 0.9);
  }
  // Outside the canvas: light gray table with a soft shadow so the canvas reads as a sheet of paper.
  // Outside the canvas: Reddit's #333 table with a 6px #505050 frame hugging the canvas.
  vec2 dOut = max(max(-p, p - canvasSize), 0.0) * zoom;
  float frame = 1.0 - step(6.0, max(dOut.x, dOut.y));
  vec3 bg = mix(vec3(0.2), vec3(0.314), frame);
  outColor = vec4(mix(bg, c, inside), 1.0);
}`

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s))
  return s
}

export function createWebGL2(canvas: HTMLCanvasElement, W: number, H: number): Renderer {
  const gl = canvas.getContext('webgl2', {
    antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false,
  })
  if (!gl) throw new Error('WebGL2 unavailable')

  const prog = gl.createProgram()!
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS))
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS))
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(prog))
  gl.useProgram(prog)
  const loc = [0, 1, 2, 3, 4].map((i) => gl.getUniformLocation(prog, 'u' + i))
  gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0)

  const tex = gl.createTexture()!
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texStorage2D(gl.TEXTURE_2D, mipLevelCount(W, H), gl.RGBA8, W, H)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.pixelStorei(gl.UNPACK_ROW_LENGTH, W)

  const uniforms = new Float32Array(UNIFORM_FLOATS)
  let mipDirty = false
  let lastDraw: [View, Overlay] | null = null

  const r: Renderer = {
    name: 'webgl2',
    onLost: null,
    resize(w, h) {
      canvas.width = w
      canvas.height = h
      gl.viewport(0, 0, w, h)
    },
    upload(rect: Rect, rgba: Uint8Array<ArrayBuffer>) {
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, rect.x)
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, rect.y)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, rect.x, rect.y, rect.w, rect.h, gl.RGBA, gl.UNSIGNED_BYTE, rgba)
      mipDirty = true
    },
    draw(view: View, overlay: Overlay) {
      lastDraw = [view, overlay]
      if (mipDirty) {
        gl.generateMipmap(gl.TEXTURE_2D)
        mipDirty = false
      }
      packUniforms(uniforms, view, overlay, W, H)
      for (let i = 0; i < 5; i++) gl.uniform4fv(loc[i]!, uniforms.subarray(i * 4, i * 4 + 4))
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },
    async readPixel(x, y) {
      if (lastDraw) r.draw(lastDraw[0], lastDraw[1])
      const out = new Uint8Array(4)
      gl.readPixels(x, canvas.height - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out)
      return [out[0]!, out[1]!, out[2]!]
    },
    destroy() {
      gl.deleteTexture(tex)
      gl.deleteProgram(prog)
      canvas.removeEventListener('webglcontextlost', lost)
    },
  }
  const lost = (e: Event) => {
    e.preventDefault()
    r.onLost?.()
  }
  canvas.addEventListener('webglcontextlost', lost)
  return r
}
