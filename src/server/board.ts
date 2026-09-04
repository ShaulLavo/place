// Canonical canvas state plus a ring buffer of recent updates for replay.

import { BLANK_COLOR, CANVAS_H, CANVAS_W, PIXEL_COUNT, RING_SIZE } from '../shared/config'
import { isValidPacked, unpackColor, unpackIndex } from '../shared/protocol'

export class Board {
  readonly w = CANVAS_W
  readonly h = CANVAS_H
  readonly data: Uint8Array
  /** Sequence number of the last applied update. Update k has seq k (1-based). */
  seq = 0
  private readonly ring = new Uint32Array(RING_SIZE)

  constructor(initial?: Uint8Array, seq = 0) {
    this.data = initial ?? new Uint8Array(PIXEL_COUNT).fill(BLANK_COLOR)
    if (this.data.length !== PIXEL_COUNT) throw new Error('board size mismatch')
    this.seq = seq
  }

  /** Apply a packed update. Returns its seq, or -1 if invalid. Rejects no-ops? No: r/place accepts them. */
  apply(packed: number): number {
    if (!isValidPacked(packed)) return -1
    this.data[unpackIndex(packed)] = unpackColor(packed)
    this.ring[this.seq % RING_SIZE] = packed
    this.seq++
    return this.seq
  }

  /** Updates with seq in (since, this.seq], or null if the ring no longer covers them. */
  since(since: number): Uint32Array | null {
    const count = this.seq - since
    if (count < 0 || count > RING_SIZE) return null
    const out = new Uint32Array(count)
    for (let i = 0; i < count; i++) out[i] = this.ring[(since + i) % RING_SIZE]!
    return out
  }
}
