// Renderer interface shared by the WebGPU and WebGL2 backends.

import type { Rect } from '../board'
import type { View } from '../camera'

export interface Overlay {
  /** Pixel under the pointer (desktop): thin outline, previews the chosen color. */
  hover: [number, number] | null
  /** Pixel picked for placement (touch/keyboard): corner-bracket reticle, previews the chosen color. */
  selected: [number, number] | null
  /** RGB in 0..1 of the chosen color, or null when none is chosen. */
  previewColor: [number, number, number] | null
  gridAlpha: number
  /** Placement pop: expanding ring at (x, y), t seconds after placing (0..0.4). */
  pop: { x: number; y: number; t: number } | null
}

export interface Renderer {
  readonly name: 'webgpu' | 'webgl2'
  /** Set the drawing buffer size in device pixels. */
  resize(w: number, h: number): void
  /** Upload a sub-rect of the full RGBA board buffer (stride = board width * 4). */
  upload(rect: Rect, rgba: Uint8Array<ArrayBuffer>): void
  draw(view: View, overlay: Overlay): void
  destroy(): void
  /** Called when the GPU context is lost; the owner rebuilds a renderer. */
  onLost: (() => void) | null
  /** Test hook: re-render the last frame off-screen and read one device pixel as RGB. */
  readPixel(x: number, y: number): Promise<[number, number, number]>
}

/** Uniform block layout shared by both shaders: 20 floats, 80 bytes. */
export const UNIFORM_FLOATS = 20

export function packUniforms(out: Float32Array, view: View, o: Overlay, canvasW: number, canvasH: number): void {
  out[0] = view.vw; out[1] = view.vh
  out[2] = canvasW; out[3] = canvasH
  out[4] = view.cx; out[5] = view.cy
  out[6] = view.zoom; out[7] = o.gridAlpha
  out[8] = o.hover ? o.hover[0] : -1; out[9] = o.hover ? o.hover[1] : -1
  out[10] = o.selected ? o.selected[0] : -1; out[11] = o.selected ? o.selected[1] : -1
  if (o.previewColor) { out[12] = o.previewColor[0]; out[13] = o.previewColor[1]; out[14] = o.previewColor[2]; out[15] = 1 }
  else { out[12] = out[13] = out[14] = 0; out[15] = 0 }
  out[16] = o.pop ? o.pop.x : -1; out[17] = o.pop ? o.pop.y : -1
  out[18] = o.pop ? o.pop.t : -1; out[19] = 0
}

export function mipLevelCount(w: number, h: number): number {
  return 1 + Math.floor(Math.log2(Math.max(w, h)))
}
