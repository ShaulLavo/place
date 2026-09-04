import { describe, expect, test } from 'bun:test'
import { Board } from './board'
import { seedBoard } from './seed'
import { BLANK_COLOR } from '../shared/config'
import { PALETTE_SIZE } from '../shared/palette'

describe('seedBoard', () => {
  test('is deterministic, in-palette, and covers most of the canvas', () => {
    const a = new Board(); seedBoard(a)
    const b = new Board(); seedBoard(b)
    expect(Array.from(a.data.subarray(0, 50000))).toEqual(Array.from(b.data.subarray(0, 50000)))
    let painted = 0
    let invalid = 0
    for (const v of a.data) { if (v >= PALETTE_SIZE) invalid++; if (v !== BLANK_COLOR) painted++ }
    expect(invalid).toBe(0)
    expect(painted).toBeGreaterThan(a.data.length * 0.6)
    expect(a.seq).toBe(0)
  })
})
