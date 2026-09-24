import { describe, expect, it } from 'vitest'
import { clampLevel, DEFAULT_LEVELS, readSettings } from './settings'

describe('readSettings', () => {
  it('starts with everything on and the old master level', () => {
    expect(readSettings(null)).toEqual({ signals: true, voice: true, levels: DEFAULT_LEVELS })
  })

  it('keeps the switches of settings saved before the mixer existed', () => {
    expect(readSettings({ signals: true, voice: false })).toEqual({
      signals: true,
      voice: false,
      levels: DEFAULT_LEVELS,
    })
  })

  it('reads saved levels and repairs broken ones', () => {
    const settings = readSettings({ levels: { master: 0.3, signals: 7, voice: 'loud' } })
    expect(settings.levels).toEqual({ master: 0.3, signals: 1, voice: DEFAULT_LEVELS.voice })
  })
})

describe('clampLevel', () => {
  it('keeps a level within 0..1', () => {
    expect(clampLevel(-0.5, 1)).toBe(0)
    expect(clampLevel(0.25, 1)).toBe(0.25)
    expect(clampLevel(Number.NaN, 0.6)).toBe(0.6)
  })
})
