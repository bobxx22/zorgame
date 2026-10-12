/* hq :: worker/pass
   One forward pass of the engine over a match journal. The journal carries
   commands, not the world (part3/03-record.md, 3.1): the cursor of the SDK
   replays them, and after every tick this pass writes down what the show needs
   - the score, the lit needles, who owns what, where the units stand - as
   changes. The page then answers any tick from memory.

   A live match is the same pass over a journal that grows: the frames of a
   tick are appended, the cursor steps to it. */

import { createEngine } from '@zoria/engine'
import { DENY_CODES, decodeManifest, decodeOrders, readRunLog, type Manifest, type SlotName } from '@zoria/protocol'
import { JournalCursor, type EngineFull, type JournalParts } from '@zoria/sdk'
import { SLOTS, packCell, slotIndex, type DenyRow, type FrameRow, type LitRow, type MatchMeta, type OwnRow, type TruthChunk, type UnitRow } from '../model/wire.ts'

/* the pass never goes back, so the cursor keeps only its first checkpoint */
const NO_CHECKPOINTS = 1_000_000_000

function frameRows(submits: readonly [number, SlotName, Uint8Array][]): FrameRow[] {
  const rows: FrameRow[] = []
  for (const [t, slot, frame] of submits) {
    const s = slotIndex(slot)
    if (s < 0) continue
    rows.push([t, s, frame.length, decodeOrders(frame)?.length ?? 0])
  }
  return rows
}

function denyRows(denies: readonly [SlotName, number, number, number][]): DenyRow[] {
  const rows: DenyRow[] = []
  for (const [slot, t, i, code] of denies) {
    const s = slotIndex(slot)
    if (s >= 0) rows.push([s, t, i, code])
  }
  return rows
}

function metaOf(man: Manifest, roster: readonly string[]): MatchMeta {
  return {
    ticks: man.ticks,
    roster: [...roster],
    needles: man.needles.map((n) => ({ q: n.q, r: n.r, start: n.start, ring: n.ring, spoke: n.spoke })),
    radius: man.terrain.radius,
    cells: man.terrain.cells,
    types: man.terrain.types.map((t) => t.name),
    seats: man.seats.map((s) => ({ q: s.q, r: s.r })),
    citadel: { q: man.citadel.q, r: man.citadel.r },
    cherta: man.cherta,
    dawnAt: man.dawn.at,
    denyWords: [...DENY_CODES],
  }
}

export class Pass {
  readonly meta: MatchMeta
  /** the channel of the whole journal: known at once for a record, empty for a live match */
  readonly frames: FrameRow[]
  readonly denies: DenyRow[]

  readonly #parts: JournalParts
  readonly #cursor: JournalCursor
  readonly #own = new Map<string, string | null>()
  readonly #lit = new Set<string>()
  readonly #units = new Map<string, number>()
  /** the last tick the journal is complete for: the whole match for a record, the cap for a live one */
  #cap: number
  #started = false

  private constructor(parts: JournalParts, man: Manifest, cap: number) {
    this.#parts = parts
    this.#cursor = new JournalCursor(createEngine, parts, NO_CHECKPOINTS)
    this.meta = metaOf(man, parts.roster)
    this.frames = frameRows(parts.submits)
    this.denies = denyRows(parts.denies ?? [])
    this.#cap = cap
  }

  /** A recorded match: the bytes of match-N.runlog. */
  static ofRecord(runlog: Uint8Array): Pass {
    const log = readRunLog(runlog)
    const man = decodeManifest(log.manifest)
    if (!man) throw new Error('the manifest of the journal did not parse')
    return new Pass({ manifest: log.manifest, bots: log.bots, submits: log.submits, roster: log.roster, episodes: log.episodes, denies: log.denies ?? [] }, man, man.ticks)
  }

  /** A match in progress: the manifest now, the frames tick by tick. */
  static ofLive(manifest: Uint8Array, bots: readonly string[], roster: readonly string[]): Pass {
    const man = decodeManifest(manifest)
    if (!man) throw new Error('the manifest of the broadcast did not parse')
    const cast = bots.filter((b): b is SlotName => slotIndex(b) >= 0)
    return new Pass({ manifest, bots: cast, submits: [], roster: [...roster], episodes: [], denies: [] }, man, 0)
  }

  get t(): number {
    return this.#cursor.t()
  }

  get finished(): boolean {
    return this.#started && this.t >= this.meta.ticks
  }

  /** Appends the frames and the denials of a live tick; the journal is complete up to it. */
  feed(t: number, submits: readonly [string, Uint8Array][], denies: readonly [string, number, number][]): { frames: FrameRow[]; denies: DenyRow[] } {
    const frames: [number, SlotName, Uint8Array][] = []
    for (const [slot, frame] of submits) if (slotIndex(slot) >= 0) frames.push([t, slot as SlotName, frame])
    const denied: [SlotName, number, number, number][] = []
    for (const [slot, i, code] of denies) if (slotIndex(slot) >= 0) denied.push([slot as SlotName, t, i, code])
    this.#parts.submits.push(...frames)
    this.#parts.denies?.push(...denied)
    if (t > this.#cap) this.#cap = Math.min(t, this.meta.ticks)
    return { frames: frameRows(frames), denies: denyRows(denied) }
  }

  /** Steps at most `maxTicks` ticks and returns their truth; null when there is nothing to step. */
  run(maxTicks: number): TruthChunk | null {
    const from = this.#started ? this.t + 1 : 0
    const to = Math.min(this.#cap, from + maxTicks - 1)
    if (to < from) return null
    const n = to - from + 1
    const chunk: TruthChunk = { from, to, score: new Float64Array(n * 3), needles: new Uint16Array(n * 3), own: [], lit: [], units: [], frames: [], denies: [] }
    for (let t = from; t <= to; t++) {
      if (this.#started) this.#cursor.step(1)
      this.#started = true
      this.#note(t, chunk, (t - from) * 3)
    }
    return chunk
  }

  #note(t: number, chunk: TruthChunk, at: number): void {
    const engine: EngineFull = this.#cursor.engine
    const world = engine.SIM.world
    SLOTS.forEach((slot, s) => {
      chunk.score[at + s] = engine.simScoreBreakdown(slot).total
      chunk.needles[at + s] = world.needles[slot] ?? 0
    })
    this.#noteOwn(t, world.own, chunk.own)
    this.#noteLit(t, world.lit, chunk.lit)
    this.#noteUnits(t, engine.SIM.units, chunk.units)
  }

  #noteOwn(t: number, own: Record<string, string>, rows: OwnRow[]): void {
    for (const cell in own) {
      const who = own[cell] || null
      if (this.#own.get(cell) === who) continue
      this.#own.set(cell, who)
      rows.push([t, cell, who])
    }
    for (const [cell, who] of this.#own) {
      if (who === null || cell in own) continue
      this.#own.set(cell, null)
      rows.push([t, cell, null])
    }
  }

  #noteLit(t: number, lit: Record<string, Record<string, number>>, rows: LitRow[]): void {
    const now = new Set<string>()
    for (const owner in lit) {
      const cells = lit[owner]
      for (const cell in cells) if ((cells[cell] ?? 0) > 0) now.add(cell)
    }
    for (const cell of now) {
      if (this.#lit.has(cell)) continue
      this.#lit.add(cell)
      rows.push([t, cell, true])
    }
    for (const cell of this.#lit) {
      if (now.has(cell)) continue
      this.#lit.delete(cell)
      rows.push([t, cell, false])
    }
  }

  #noteUnits(t: number, units: EngineFull['SIM']['units'], rows: UnitRow[]): void {
    const seen = new Set<string>()
    for (const u of units) {
      if (u.dead) continue
      seen.add(u.id)
      const at = packCell(u.q, u.r)
      if (this.#units.get(u.id) === at) continue
      this.#units.set(u.id, at)
      rows.push([t, u.id, u.p, u.cls, u.q, u.r, true])
    }
    for (const id of this.#units.keys()) {
      if (seen.has(id)) continue
      this.#units.delete(id)
      rows.push([t, id, '', '', 0, 0, false])
    }
  }
}
