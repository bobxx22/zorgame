import { describe, expect, it } from 'vitest'
import { detectCues, tickSecond, type Watch } from './cues'

const base: Watch = {
  phase: 'static',
  opensAtMs: null,
  jams: 0,
  registered: false,
  lost: false,
  access: null,
  released: null,
  unread: null,
  closingSoon: false,
}

describe('detectCues', () => {
  it('stays quiet on the first look and when nothing moved', () => {
    expect(detectCues(null, { ...base, phase: 'window' })).toEqual([])
    expect(detectCues(base, base)).toEqual([])
  })

  it('announces the window only on a change seen in the tab', () => {
    expect(detectCues(base, { ...base, phase: 'window' })).toEqual([{ sfx: 'window', voice: 'window-open' }])
    // Loaded straight into the window: the phase was unknown before.
    expect(detectCues({ ...base, phase: null }, { ...base, phase: 'window' })).toEqual([])
  })

  it('announces the harbinger when the countdown appears in static', () => {
    expect(detectCues(base, { ...base, opensAtMs: 1 })).toEqual([{ sfx: 'harbinger', voice: 'harbinger' }])
    expect(detectCues({ ...base, phase: null }, { ...base, opensAtMs: 1 })).toEqual([])
  })

  it('announces registration, verified access and a lost session', () => {
    expect(detectCues(base, { ...base, registered: true })).toEqual([{ sfx: 'confirm', voice: 'registered' }])
    expect(detectCues({ ...base, access: 'pending' }, { ...base, access: 'verified' })).toEqual([
      { sfx: 'verified', voice: 'verified' },
    ])
    expect(detectCues(base, { ...base, access: 'verified' })).toEqual([])
    expect(detectCues(base, { ...base, lost: true })).toEqual([{ sfx: 'error', voice: 'lost' }])
  })

  it('prefers the new part over its letter', () => {
    const prev = { ...base, released: 1, unread: 0 }
    expect(detectCues(prev, { ...prev, released: 2, unread: 1 })).toEqual([{ sfx: 'stage', voice: 'new-stage' }])
    expect(detectCues(prev, { ...prev, unread: 2 })).toEqual([{ sfx: 'letter', voice: 'letter' }])
    expect(detectCues(prev, { ...prev, unread: 0 })).toEqual([])
  })

  it('does not count the first summary after login as news', () => {
    expect(detectCues(base, { ...base, released: 2, unread: 3 })).toEqual([])
  })

  it('announces a jam and the closing window', () => {
    expect(detectCues(base, { ...base, jams: 1 })).toEqual([{ sfx: 'error', voice: 'jammed' }])
    expect(detectCues(base, { ...base, closingSoon: true })).toEqual([{ sfx: 'harbinger', voice: 'closing' }])
  })
})

describe('tickSecond', () => {
  it('ticks through the last ten seconds only', () => {
    expect(tickSecond(null, 0)).toBeNull()
    expect(tickSecond(20_000, 0)).toBeNull()
    expect(tickSecond(10_000, 0)).toBe(10)
    expect(tickSecond(10_000, 9_100)).toBe(1)
    expect(tickSecond(10_000, 10_000)).toBeNull()
  })
})
