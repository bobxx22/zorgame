import { describe, expect, it } from 'vitest'
import { formatLocal, parseServerTime, utcOffsetLabel, zoneLabel } from './time'

const WINDOW = '2026-09-24T09:00:04.311Z'

describe('parseServerTime', () => {
  it('parses ISO with milliseconds', () => {
    expect(parseServerTime(WINDOW)?.getTime()).toBe(Date.UTC(2026, 8, 24, 9, 0, 4, 311))
  })
  it('returns null for null and garbage', () => {
    expect(parseServerTime(null)).toBeNull()
    expect(parseServerTime('tomorrow')).toBeNull()
  })
})

describe('utcOffsetLabel', () => {
  it('names whole-hour and fractional offsets', () => {
    const at = new Date(WINDOW)
    expect(utcOffsetLabel(at, 'Europe/Kyiv')).toBe('UTC+3')
    expect(utcOffsetLabel(at, 'UTC')).toBe('UTC')
    expect(utcOffsetLabel(at, 'Asia/Kolkata')).toBe('UTC+5:30')
    expect(utcOffsetLabel(at, 'America/New_York')).toBe('UTC-4')
  })
})

describe('formatLocal', () => {
  it('shows server UTC in the given zone', () => {
    expect(formatLocal(WINDOW, 'Europe/Kyiv')).toBe('24.09.2026, 12:00:04')
  })
  it('renders a dash for missing time', () => {
    expect(formatLocal(null, 'Europe/Kyiv')).toBe('—')
  })
  it('labels the zone', () => {
    expect(zoneLabel(new Date(WINDOW), 'Europe/Kyiv')).toBe('Europe/Kyiv (UTC+3)')
  })
})
