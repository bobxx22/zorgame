/* hq :: model/match
   One match as the show reads it: the truth of the world by tick (computed by
   the engine in the worker and delivered in chunks) and the channel of every
   slot (taken from the journal as is). Everything is answered from memory. */

import { changesOf, indexAt, newChanges, pushChange, valueAt, type Changes } from './changes.ts'
import { cellQ, cellR, packCell, type DenyRow, type FrameRow, type MatchMeta, type TruthChunk } from './wire.ts'

export interface UnitTrack {
  owner: string
  cls: string
  /** the cell as q * 256 + r (offset by 128), or null while the unit is not on the field */
  at: Changes<number | null>
}

export interface UnitAt {
  id: string
  owner: string
  cls: string
  q: number
  r: number
}

export class MatchIndex {
  readonly meta: MatchMeta
  /** the truth is known for ticks 0..done; -1 before the first chunk */
  done = -1
  /** the channel is known for ticks 1..framesTo */
  framesTo = 0
  readonly own = new Map<string, Changes<string | null>>()
  readonly lit = new Map<string, Changes<boolean>>()
  readonly units = new Map<string, UnitTrack>()

  readonly #score: Float64Array
  readonly #needles: Uint16Array
  readonly #bytes: Uint16Array
  readonly #orders: Uint16Array
  /** per slot: tick -> [command number, code] */
  readonly #denies = [new Map<number, [number, number][]>(), new Map<number, [number, number][]>(), new Map<number, [number, number][]>()]
  #denyTop: (number | null)[] = [null, null, null]
  /** the ticks at which an owner, a light or a unit changed, ascending */
  readonly #changed: number[] = []

  constructor(meta: MatchMeta) {
    this.meta = meta
    const n = (meta.ticks + 1) * 3
    this.#score = new Float64Array(n)
    this.#needles = new Uint16Array(n)
    this.#bytes = new Uint16Array(n)
    this.#orders = new Uint16Array(n)
  }

  addFrames(rows: readonly FrameRow[], upTo: number): void {
    for (const [t, slot, bytes, orders] of rows) {
      if (t < 0 || t > this.meta.ticks) continue
      this.#bytes[t * 3 + slot] = bytes
      this.#orders[t * 3 + slot] = orders
    }
    if (upTo > this.framesTo) this.framesTo = upTo
  }

  addDenies(rows: readonly DenyRow[]): void {
    for (const [slot, t, i, code] of rows) {
      const map = this.#denies[slot]
      if (!map) continue
      let list = map.get(t)
      if (!list) {
        list = []
        map.set(t, list)
      }
      list.push([i, code])
      this.#denyTop[slot] = null
    }
  }

  addChunk(chunk: TruthChunk): void {
    const ticks = this.meta.ticks
    for (let t = chunk.from; t <= chunk.to && t <= ticks; t++) {
      const src = (t - chunk.from) * 3
      for (let s = 0; s < 3; s++) {
        this.#score[t * 3 + s] = chunk.score[src + s] ?? 0
        this.#needles[t * 3 + s] = chunk.needles[src + s] ?? 0
      }
    }
    for (const [t, cell, who] of chunk.own) pushChange(changesOf(this.own, cell), t, who)
    for (const [t, cell, on] of chunk.lit) pushChange(changesOf(this.lit, cell), t, on)
    for (const [t, id, owner, cls, q, r, alive] of chunk.units) {
      let track = this.units.get(id)
      if (!track) {
        track = { owner, cls, at: newChanges<number | null>() }
        this.units.set(id, track)
      }
      pushChange(track.at, t, alive ? packCell(q, r) : null)
    }
    const ticksOf = new Set<number>()
    for (const row of chunk.own) ticksOf.add(row[0])
    for (const row of chunk.lit) ticksOf.add(row[0])
    for (const row of chunk.units) ticksOf.add(row[0])
    this.#changed.push(...[...ticksOf].sort((a, b) => a - b))
    this.addFrames(chunk.frames, chunk.to)
    this.addDenies(chunk.denies)
    if (chunk.to > this.done) this.done = Math.min(chunk.to, ticks)
  }

  /** Whether the truth of tick `t` has been computed. */
  known(t: number): boolean {
    return t >= 0 && t <= this.done
  }

  /** The owner of the needle in the cell by the truth: a slot letter, K or null. */
  ownerAt(cell: string, t: number): string | null {
    return valueAt(this.own.get(cell), t) ?? null
  }

  litAt(cell: string, t: number): boolean {
    return valueAt(this.lit.get(cell), t) === true
  }

  scoreAt(slot: number, t: number): number {
    return this.#score[t * 3 + slot] ?? 0
  }

  needlesAt(slot: number, t: number): number {
    return this.#needles[t * 3 + slot] ?? 0
  }

  bytesAt(slot: number, t: number): number {
    return this.#bytes[t * 3 + slot] ?? 0
  }

  ordersAt(slot: number, t: number): number {
    return this.#orders[t * 3 + slot] ?? 0
  }

  deniesAt(slot: number, t: number): readonly [number, number][] {
    return this.#denies[slot]?.get(t) ?? []
  }

  /** The denial word of command `i` at tick `t`; null when the command was accepted. */
  denyWord(slot: number, t: number, i: number): string | null {
    const hit = this.deniesAt(slot, t).find((d) => d[0] === i)
    return hit ? (this.meta.denyWords[hit[1]] ?? String(hit[1])) : null
  }

  /** The tick with the most denials of the slot; the smaller tick on a tie; 0 when there were none. */
  denyTopTick(slot: number): number {
    const cached = this.#denyTop[slot]
    if (cached !== null && cached !== undefined) return cached
    let best = 0
    let most = 0
    for (const [t, list] of this.#denies[slot] ?? []) {
      if (list.length > most || (list.length === most && most > 0 && t < best)) {
        most = list.length
        best = t
      }
    }
    this.#denyTop[slot] = best
    return best
  }

  /** The units on the field at tick `t`. */
  unitsAt(t: number): UnitAt[] {
    const out: UnitAt[] = []
    for (const [id, track] of this.units) {
      const at = valueAt(track.at, t)
      if (at === null || at === undefined) continue
      out.push({ id, owner: track.owner, cls: track.cls, q: cellQ(at), r: cellR(at) })
    }
    return out
  }

  /** A number that is equal for two ticks exactly when nothing on the field changed between them. */
  changeStamp(t: number): number {
    return indexAt(this.#changed, t)
  }
}
