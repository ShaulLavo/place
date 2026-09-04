import { describe, expect, test } from 'bun:test'
import { Board } from './board'
import { pack, unpack } from '../shared/protocol'
import { BLANK_COLOR, RING_SIZE } from '../shared/config'

describe('Board', () => {
  test('starts blank and applies updates in sequence', () => {
    const b = new Board()
    expect(b.data[0]).toBe(BLANK_COLOR)
    expect(b.apply(pack(5, 7, 3))).toBe(1)
    expect(b.apply(pack(5, 7, 4))).toBe(2)
    expect(b.data[7 * b.w + 5]).toBe(4)
    expect(b.apply(0xffffffff)).toBe(-1)
    expect(b.seq).toBe(2)
  })

  test('since() replays exactly the missed updates', () => {
    const b = new Board()
    const ps = [pack(1, 1, 1), pack(2, 2, 2), pack(3, 3, 3)]
    ps.forEach((p) => b.apply(p))
    expect(Array.from(b.since(0)!)).toEqual(ps)
    expect(Array.from(b.since(1)!)).toEqual(ps.slice(1))
    expect(b.since(3)!.length).toBe(0)
    expect(b.since(4)).toBeNull()
  })

  test('since() returns null once the ring has wrapped past the requested seq', () => {
    const b = new Board()
    for (let i = 0; i < RING_SIZE + 10; i++) b.apply(pack(i % 100, 0, i & 31))
    expect(b.since(0)).toBeNull()
    expect(b.since(9)).toBeNull()
    const tail = b.since(10)!
    expect(tail.length).toBe(RING_SIZE)
    expect(unpack(tail[0]!)).toEqual({ x: 10 % 100, y: 0, color: 10 & 31 })
  })
})
