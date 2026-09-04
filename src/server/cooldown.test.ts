import { describe, expect, test } from 'bun:test'
import { Cooldown } from './cooldown'

describe('Cooldown', () => {
  test('zero cooldown always allows', () => {
    const c = new Cooldown(0)
    expect(c.tryPlace('a', 100)).toBe(0)
    expect(c.tryPlace('a', 100)).toBe(0)
  })

  test('enforces the window and sweeps', () => {
    const c = new Cooldown(1000)
    expect(c.tryPlace('a', 100)).toBe(1100)
    expect(c.tryPlace('a', 500)).toBeNull()
    expect(c.nextAllowed('a')).toBe(1100)
    expect(c.tryPlace('b', 500)).toBe(1500)
    expect(c.tryPlace('a', 1100)).toBe(2100)
    c.sweep(1600)
    expect(c.nextAllowed('b')).toBe(0)
    expect(c.nextAllowed('a')).toBe(2100)
  })
})
