import { describe, expect, it } from 'vitest'
import { findOwnEntry } from './roll-match'

const entry = (n: number, at: string, name: string) => ({ n, at, sinceOpen: n, name })
const roll = [
  entry(1, '2026-09-24T09:00:04.000Z', 'Вахта'),
  entry(2, '2026-09-24T09:01:30.000Z', 'Вахта'),
  entry(3, '2026-09-24T09:01:31.000Z', 'Stitch'),
]

describe('findOwnEntry', () => {
  it('finds the line by the moment of registration, not by a shared name', () => {
    expect(findOwnEntry(roll, { createdAt: '2026-09-24T09:01:30.200Z', displayName: 'Вахта' })?.n).toBe(2)
  })
  it('lets the name break a tie between lines of the same moment', () => {
    expect(findOwnEntry(roll, { createdAt: '2026-09-24T09:01:30.900Z', displayName: 'Stitch' })?.n).toBe(3)
  })
  it('trusts a name alone only when it is unique', () => {
    expect(findOwnEntry(roll, { createdAt: '2026-09-25T00:00:00.000Z', displayName: 'Stitch' })?.n).toBe(3)
    expect(findOwnEntry(roll, { createdAt: '2026-09-25T00:00:00.000Z', displayName: 'Вахта' })).toBeUndefined()
  })
})
