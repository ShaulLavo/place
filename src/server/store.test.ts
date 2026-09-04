import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from './store'
import { pack } from '../shared/protocol'

const dirs: string[] = []
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'place-')); dirs.push(d); return d }
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))

describe('Store', () => {
  test('snapshot + log replay restores the exact board and seq', () => {
    const dir = tmp()
    const s1 = new Store(dir)
    const b1 = s1.load()
    b1.apply(pack(1, 1, 5)); s1.append(pack(1, 1, 5), 1)
    b1.apply(pack(2, 2, 6)); s1.append(pack(2, 2, 6), 1)
    expect(s1.snapshot(b1)).toBe(true)
    expect(s1.snapshot(b1)).toBe(false)
    // Two more placements land only in the log.
    b1.apply(pack(3, 3, 7)); s1.append(pack(3, 3, 7), 2)
    b1.apply(pack(1, 1, 8)); s1.append(pack(1, 1, 8), 2)
    s1.flushLog()

    const s2 = new Store(dir)
    const b2 = s2.load()
    expect(b2.seq).toBe(4)
    expect(b2.data[1 * b2.w + 1]).toBe(8)
    expect(b2.data[2 * b2.w + 2]).toBe(6)
    expect(b2.data[3 * b2.w + 3]).toBe(7)
    expect(Array.from(b2.data)).toEqual(Array.from(b1.data))
  })

  test('fresh dir yields a blank board', () => {
    const s = new Store(tmp())
    const b = s.load()
    expect(b.seq).toBe(0)
  })
})
