import type { Renderer } from './renderer'
import { createWebGL2 } from './webgl2'
import { createWebGPU } from './webgpu'

export type { Renderer, Overlay } from './renderer'

export async function createRenderer(canvas: HTMLCanvasElement, W: number, H: number, prefer: string | null): Promise<Renderer> {
  if (prefer !== 'webgl2') {
    try {
      const r = await createWebGPU(canvas, W, H, prefer === 'webgpu')
      if (r) return r
    } catch (e) {
      console.warn('[render] WebGPU init failed, falling back to WebGL2', e)
    }
  }
  return createWebGL2(canvas, W, H)
}
