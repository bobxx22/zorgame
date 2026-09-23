import { describe, expect, it } from 'vitest'
import { parseFrame, type EtherFrame } from './frame'
import { signalFrame } from './fixtures'
import { applyFrame, initialStation, letter, restoreLetter, serverNow, storedLetter } from './station'

function frame(patch: Record<string, unknown>): EtherFrame {
  const parsed = parseFrame(JSON.stringify(signalFrame(patch)))
  if (!parsed) throw new Error('bad test frame')
  return parsed
}

const T0 = Date.parse('2026-09-24T03:00:00.000Z')
const harbinger = (opensIn: number) => ({ opensIn, text: { uk: 'несуча', ru: 'несущая' } })

describe('applyFrame', () => {
  it('takes phase and countdown from a harbinger frame', () => {
    const s = applyFrame(initialStation, frame({ harbinger: harbinger(21_600) }), T0)
    expect(s.phase).toBe('static')
    expect(s.opensAtMs).toBe(Date.parse('2026-09-24T09:00:00.000Z'))
    expect(s.harbingerText?.uk).toBe('несуча')
  })

  it('does not roll back on an echo or a delayed frame (CL-05)', () => {
    const windowFrame = frame({
      at: '2026-09-24T09:00:10.000Z',
      phase: 'window',
      window: { opensAt: '2026-09-24T09:00:00.000Z', closesAt: '2026-09-24T19:00:00.000Z' },
    })
    let s = applyFrame(initialStation, windowFrame, T0)
    s = applyFrame(s, frame({ harbinger: harbinger(600) }), T0)
    expect(s.phase).toBe('window')
    expect(s.opensAtMs).toBeNull()
    expect(s.echoes).toBe(1)
    expect(s.signals).toBe(2)
  })

  it('follows an extension of closesAt (CL-12)', () => {
    const w = (at: string, closesAt: string) =>
      frame({ at, phase: 'window', window: { opensAt: '2026-09-24T09:00:00.000Z', closesAt } })
    let s = applyFrame(initialStation, w('2026-09-24T10:00:00.000Z', '2026-09-24T19:00:00.000Z'), T0)
    s = applyFrame(s, w('2026-09-24T11:00:00.000Z', '2026-09-24T19:45:00.000Z'), T0)
    expect(s.window?.closesAtMs).toBe(Date.parse('2026-09-24T19:45:00.000Z'))
  })

  it('drops the countdown when a newer static frame has no harbinger', () => {
    let s = applyFrame(initialStation, frame({ harbinger: harbinger(600) }), T0)
    s = applyFrame(s, frame({ at: '2026-09-24T03:01:00.000Z' }), T0)
    expect(s.opensAtMs).toBeNull()
  })

  it('estimates the server clock from the freshest sample (CL-11)', () => {
    // Local clock 2 min behind; the second frame came 6 s late (delay noise).
    let s = applyFrame(initialStation, frame({ at: '2026-09-24T03:00:00.000Z' }), T0 - 120_000)
    s = applyFrame(s, frame({ at: '2026-09-24T03:00:15.000Z' }), T0 + 15_000 - 120_000 + 6_000)
    expect(s.clockOffsetMs).toBe(120_000)
    expect(serverNow(s, T0 - 120_000)).toBe(T0)
  })

  it('assembles the letter by number and drops repeats (CL-35)', () => {
    let s = initialStation
    s = applyFrame(s, frame({ fragment: { n: 3, of: 4, text: 'третій' } }), T0)
    s = applyFrame(s, frame({ at: '2026-09-24T03:00:15.000Z', fragment: { n: 1, of: 4, text: 'перший' } }), T0)
    s = applyFrame(s, frame({ at: '2026-09-24T03:00:30.000Z', fragment: { n: 3, of: 4, text: 'підміна' } }), T0)
    expect(letter(s)).toEqual(['перший', null, 'третій', null])
  })

  it('keeps the newest roll', () => {
    const roll = (at: string, names: string[]) =>
      frame({
        kind: 'roll',
        at,
        phase: 'window',
        window: { opensAt: '2026-09-24T09:00:00.000Z', closesAt: '2026-09-24T19:00:00.000Z' },
        roll: names.map((name, i) => ({ n: i + 1, at: '2026-09-24T09:00:04.311Z', sinceOpen: 4, name })),
      })
    let s = applyFrame(initialStation, roll('2026-09-24T09:05:00.000Z', ['a', 'b']), T0)
    s = applyFrame(s, roll('2026-09-24T09:04:00.000Z', ['a']), T0)
    expect(s.roll?.entries.map((e) => e.name)).toEqual(['a', 'b'])
  })
})

describe('letter kept between visits', () => {
  it('restores a kept letter and ignores junk', () => {
    const kept = restoreLetter(initialStation, { of: 32, fragments: { 3: 'уривок', 40: 'поза листом', x: 'ні' } })
    expect(kept.fragmentsOf).toBe(32)
    expect(kept.fragments).toEqual({ 3: 'уривок' })
    expect(storedLetter(kept)).toEqual({ of: 32, fragments: { 3: 'уривок' } })
    expect(restoreLetter(initialStation, 'broken')).toBe(initialStation)
    expect(restoreLetter(initialStation, { of: 0, fragments: {} })).toBe(initialStation)
    expect(storedLetter(initialStation)).toBeNull()
  })
})
