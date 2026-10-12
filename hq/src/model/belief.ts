/* hq :: model/belief
   The belief diary of the focus bot (part3/03-record.md, section 4) as an
   index by tick. The diary is delta-encoded: a full frame once in a while, the
   other lines carry only what changed. A full frame carries the whole belief,
   so a needle that is missing from it is no longer in the belief at all.

   Contacts with enemy units are not a state but events of a tick: their
   history is kept per unit, and the memory of a unit at a tick is its last
   contact no later than that tick. */

import { changesOf, indexAt, pushChange, valueAt, type Changes } from './changes.ts'
import { isRecord } from './guards.ts'

export interface BeliefFrame {
  t: number
  full?: boolean
  own?: Record<string, string | null>
  dark?: Record<string, boolean>
  foe?: [string, string, number, number][]
}

/** A contact with an enemy unit: the tick, its slot letter and its cell. */
export interface Contact {
  t: number
  slot: string
  q: number
  r: number
}

/** A diary line as a frame; `null` for a line that is not one. */
export function readFrame(v: unknown): BeliefFrame | null {
  if (!isRecord(v) || typeof v.t !== 'number') return null
  const frame: BeliefFrame = { t: v.t }
  if (v.full === true) frame.full = true
  if (isRecord(v.own)) {
    const own: Record<string, string | null> = {}
    for (const [cell, who] of Object.entries(v.own)) own[cell] = typeof who === 'string' && who !== '' ? who : null
    frame.own = own
  }
  if (isRecord(v.dark)) {
    const dark: Record<string, boolean> = {}
    for (const [cell, silent] of Object.entries(v.dark)) dark[cell] = silent === true
    frame.dark = dark
  }
  if (Array.isArray(v.foe)) {
    const foe: [string, string, number, number][] = []
    for (const c of v.foe as unknown[]) {
      if (!Array.isArray(c)) continue
      const [unit, slot, q, r] = c as unknown[]
      if (typeof unit === 'string' && typeof slot === 'string' && typeof q === 'number' && typeof r === 'number') foe.push([unit, slot, q, r])
    }
    frame.foe = foe
  }
  return frame
}

export class BeliefIndex {
  /** the believed owner of a needle: a slot letter, `null` (unowned) or `undefined` (not in the belief) */
  readonly own = new Map<string, Changes<string | null | undefined>>()
  /** the believed silence of a needle; `undefined` - not in the belief */
  readonly dark = new Map<string, Changes<boolean | undefined>>()
  /** the contacts with every enemy unit, by tick */
  readonly foe = new Map<string, Changes<Contact>>()
  /** the tick of the last frame; -1 for an empty diary */
  last = -1
  /** diary lines that could not be read */
  skipped = 0
  /** why the first of them could not: for the note on the page */
  skippedWhy = ''

  /** the ticks whose frame carried a change, ascending */
  readonly #changed: number[] = []
  readonly #ownNow = new Set<string>()
  readonly #darkNow = new Set<string>()

  push(frame: BeliefFrame): void {
    const t = frame.t
    if (t < this.last) {
      /* the diary goes forward only; a line from the past cannot be placed */
      this.skip(`a frame of tick ${t} after tick ${this.last}`)
      return
    }
    this.last = t
    if (frame.full || frame.own || frame.dark || (frame.foe?.length ?? 0) > 0) this.#changed.push(t)
    if (frame.full) {
      this.#forget(this.own, this.#ownNow, frame.own ?? {}, t)
      this.#forget(this.dark, this.#darkNow, frame.dark ?? {}, t)
    }
    for (const [cell, who] of Object.entries(frame.own ?? {})) {
      pushChange(changesOf(this.own, cell), t, who)
      this.#ownNow.add(cell)
    }
    for (const [cell, silent] of Object.entries(frame.dark ?? {})) {
      pushChange(changesOf(this.dark, cell), t, silent)
      this.#darkNow.add(cell)
    }
    for (const [unit, slot, q, r] of frame.foe ?? []) pushChange(changesOf(this.foe, unit), t, { t, slot, q, r })
  }

  /** Takes one line of the diary: a frame as text, or already parsed. A line that is not a frame is counted with its reason. */
  pushLine(line: unknown): void {
    let parsed = line
    if (typeof line === 'string') {
      try {
        parsed = JSON.parse(line)
      } catch (error) {
        this.skip(error instanceof Error ? error.message : String(error))
        return
      }
    }
    const frame = readFrame(parsed)
    if (frame) this.push(frame)
    else this.skip('a line without a tick')
  }

  /** Counts a line that could not be read; the first reason is kept. */
  skip(reason: string): void {
    if (this.skipped === 0) this.skippedWhy = reason
    this.skipped += 1
  }

  /** The believed owner at tick `t`: a slot letter, `null` for an unowned needle, `undefined` when the belief has no entry. */
  ownerAt(cell: string, t: number): string | null | undefined {
    return valueAt(this.own.get(cell), t)
  }

  /** Whether the needle keeps silence by the belief at tick `t`. */
  darkAt(cell: string, t: number): boolean {
    return valueAt(this.dark.get(cell), t) === true
  }

  /** The last contact with the unit no later than tick `t`. */
  contact(unit: string, t: number): Contact | null {
    return valueAt(this.foe.get(unit), t) ?? null
  }

  /** The units the focus has met no later than tick `t`, by name. */
  unitsSeen(t: number): string[] {
    const out: string[] = []
    for (const [unit, contacts] of this.foe) if ((contacts.t[0] ?? Infinity) <= t) out.push(unit)
    return out.sort()
  }

  /** A number that is equal for two ticks exactly when the belief did not change between them. */
  changeStamp(t: number): number {
    return indexAt(this.#changed, t)
  }

  /* a full frame is the whole belief: what it does not name is gone from it */
  #forget<T>(map: Map<string, Changes<T | undefined>>, now: Set<string>, kept: Record<string, unknown>, t: number): void {
    for (const cell of now) {
      if (cell in kept) continue
      pushChange(changesOf(map, cell), t, undefined)
      now.delete(cell)
    }
  }
}

/** Reads a diary (NDJSON) into an index; lines that are not frames are counted, not hidden. */
export function readDiary(text: string): BeliefIndex {
  const index = new BeliefIndex()
  for (const line of text.split('\n')) if (line.trim() !== '') index.pushLine(line)
  return index
}
