// Client-side mirror of the canvas: palette indices (truth) + RGBA copy for the GPU,
// with a coalesced dirty rectangle consumed once per frame.

import { BLANK_COLOR, CANVAS_H, CANVAS_W, PIXEL_COUNT } from '../shared/config'
import { PALETTE_RGBA } from '../shared/palette'
import { unpackColor, unpackIndex, type UpdatesFrame } from '../shared/protocol'

export interface Rect { x: number; y: number; w: number; h: number }

export type ApplyResult = 'ok' | 'gap' | 'stale'

export class ClientBoard {
  readonly w = CANVAS_W
  readonly h = CANVAS_H
  readonly indices = new Uint8Array(PIXEL_COUNT).fill(BLANK_COLOR)
  readonly rgba: Uint8Array<ArrayBuffer> = new Uint8Array(PIXEL_COUNT * 4)
  /** Seq of the last update applied. */
  seq = 0
  /** Total updates applied since load, for the stats readout. */
  applied = 0
  private dirty: { x0: number; y0: number; x1: number; y1: number } | null = null

  constructor() {
    this.fillRgba()
    this.markAll()
  }

  private fillRgba(): void {
    const { indices, rgba } = this
    for (let i = 0, o = 0; i < PIXEL_COUNT; i++, o += 4) {
      const c = indices[i]! * 4
      rgba[o] = PALETTE_RGBA[c]!
      rgba[o + 1] = PALETTE_RGBA[c + 1]!
      rgba[o + 2] = PALETTE_RGBA[c + 2]!
      rgba[o + 3] = 255
    }
  }

  private markAll(): void {
    this.dirty = { x0: 0, y0: 0, x1: this.w, y1: this.h }
  }

  colorAt(x: number, y: number): number {
    return this.indices[y * this.w + x]!
  }

  set(index: number, color: number): void {
    this.indices[index] = color
    const o = index * 4
    const c = color * 4
    this.rgba[o] = PALETTE_RGBA[c]!
    this.rgba[o + 1] = PALETTE_RGBA[c + 1]!
    this.rgba[o + 2] = PALETTE_RGBA[c + 2]!
    const x = index % this.w
    const y = (index / this.w) | 0
    const d = this.dirty
    if (!d) this.dirty = { x0: x, y0: y, x1: x + 1, y1: y + 1 }
    else {
      if (x < d.x0) d.x0 = x
      if (y < d.y0) d.y0 = y
      if (x + 1 > d.x1) d.x1 = x + 1
      if (y + 1 > d.y1) d.y1 = y + 1
    }
  }

  loadSnapshot(bytes: Uint8Array, seq: number): void {
    if (bytes.length !== PIXEL_COUNT) throw new Error(`snapshot size ${bytes.length} != ${PIXEL_COUNT}`)
    this.indices.set(bytes)
    this.fillRgba()
    this.markAll()
    this.seq = seq
  }

  /** Apply a broadcast frame, skipping updates we already have. 'gap' means we must resync. */
  applyFrame(f: UpdatesFrame): ApplyResult {
    const n = f.packed.length
    if (n === 0) return 'ok'
    const last = f.firstSeq + n - 1
    if (last <= this.seq) return 'stale'
    if (f.firstSeq > this.seq + 1) return 'gap'
    const start = this.seq + 1 - f.firstSeq
    for (let i = start; i < n; i++) {
      const p = f.packed[i]!
      this.set(unpackIndex(p), unpackColor(p))
    }
    this.applied += n - start
    this.seq = last
    return 'ok'
  }

  /** Returns and clears the dirty rect. */
  takeDirty(): Rect | null {
    const d = this.dirty
    if (!d) return null
    this.dirty = null
    return { x: d.x0, y: d.y0, w: d.x1 - d.x0, h: d.y1 - d.y0 }
  }
}
