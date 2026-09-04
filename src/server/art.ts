// Loads baked canvases from art/*.idx.gz (see scripts/bake-art.ts).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Art { w: number; h: number; data: Uint8Array }

const ART_DIR = join(import.meta.dir, '../../art')

export function loadArt(name: string): Art | null {
  const file = join(ART_DIR, name + '.idx.gz')
  if (!existsSync(file)) return null
  const raw = Bun.gunzipSync(readFileSync(file))
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const w = dv.getUint32(0, true), h = dv.getUint32(4, true)
  return { w, h, data: new Uint8Array(raw.buffer, raw.byteOffset + 8, w * h) }
}

/** Blit art onto a board at (ox, oy), cropping to the board. */
export function blit(board: { w: number; h: number; data: Uint8Array }, art: Art, ox = 0, oy = 0): void {
  const x0 = Math.max(0, ox), y0 = Math.max(0, oy)
  const x1 = Math.min(board.w, ox + art.w), y1 = Math.min(board.h, oy + art.h)
  for (let y = y0; y < y1; y++) {
    const srcRow = (y - oy) * art.w + (x0 - ox)
    board.data.set(art.data.subarray(srcRow, srcRow + (x1 - x0)), y * board.w + x0)
  }
}
