import { describe, expect, it } from 'vitest'
import { Backoff, backoffCeiling, fullJitter } from './backoff'

describe('backoffCeiling', () => {
  it('doubles from 1 s and stops at 60 s', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 50].map((n) => backoffCeiling(n))).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000,
    ])
  })
})

describe('fullJitter', () => {
  it('stays in [0, ceiling)', () => {
    expect(fullJitter(3, () => 0)).toBe(0)
    expect(fullJitter(3, () => 0.999999)).toBeLessThan(8_000)
    expect(fullJitter(10, () => 0.5)).toBe(30_000)
  })
})

describe('Backoff', () => {
  it('grows the streak and resets after success', () => {
    const b = new Backoff(() => 0.5)
    expect([b.next(), b.next(), b.next()]).toEqual([500, 1_000, 2_000])
    expect(b.streak).toBe(3)
    b.reset()
    expect(b.next()).toBe(500)
  })
})
