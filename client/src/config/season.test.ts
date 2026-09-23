import { describe, expect, it } from 'vitest'
import { SEASON_EVENTS, seasonPercent } from './season'

describe('seasonPercent', () => {
  it('puts the start at 0 and a week later at 7/31', () => {
    expect(seasonPercent('2026-09-21T00:00:00.000Z')).toBe(0)
    expect(seasonPercent('2026-09-28T00:00:00.000Z')).toBeCloseTo((7 / 31) * 100, 6)
  })
  it('matches the window band of the site calendar', () => {
    const window = SEASON_EVENTS.find((e) => e.kind === 'window')
    expect(window?.to).toBeDefined()
    const from = seasonPercent(window?.from ?? '') ?? 0
    const to = seasonPercent(window?.to ?? '') ?? 0
    // site: left 10.35 %, width 3.76 %
    expect(from).toBeCloseTo(10.35, 1)
    expect(to - from).toBeCloseTo(3.76, 1)
  })
  it('is null outside the season and for garbage', () => {
    expect(seasonPercent('2026-09-20T23:59:59.000Z')).toBeNull()
    expect(seasonPercent('2026-11-01T00:00:00.000Z')).toBeNull()
    expect(seasonPercent('soon')).toBeNull()
  })
  it('keeps events in calendar order', () => {
    const times = SEASON_EVENTS.map((e) => Date.parse(e.from))
    expect([...times].sort((a, b) => a - b)).toEqual(times)
  })
})
