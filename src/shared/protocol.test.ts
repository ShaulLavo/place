import { describe, expect, test } from 'bun:test'
import { decodeFrame, encodeUpdates, isValidPacked, pack, unpack, FRAME_HEADER } from './protocol'
import { CANVAS_H, CANVAS_W } from './config'

describe('protocol', () => {
  test('pack/unpack round-trips the corners', () => {
    for (const [x, y, c] of [[0, 0, 0], [CANVAS_W - 1, CANVAS_H - 1, 31], [1234, 567, 17]] as const) {
      const p = pack(x, y, c)
      expect(p).toBeGreaterThanOrEqual(0)
      expect(unpack(p)).toEqual({ x, y, color: c })
      expect(isValidPacked(p)).toBe(true)
    }
  })

  test('rejects out-of-range packed values', () => {
    expect(isValidPacked(pack(0, CANVAS_H, 0))).toBe(false)
    expect(isValidPacked(0xffffffff)).toBe(false)
  })

  test('updates frame round-trips with aligned payload', () => {
    const packed = [pack(1, 2, 3), pack(4, 5, 6), pack(7, 8, 9)]
    const buf = encodeUpdates(1000, packed)
    expect(buf.byteLength).toBe(FRAME_HEADER + 12)
    const f = decodeFrame(buf.buffer)!
    expect(f.firstSeq).toBe(1000)
    expect(Array.from(f.packed)).toEqual(packed)
  })

  test('decodeFrame rejects garbage', () => {
    expect(decodeFrame(new Uint8Array([1, 0, 0]).buffer)).toBeNull()
    expect(decodeFrame(new Uint8Array(9).buffer)).toBeNull()
  })
})
