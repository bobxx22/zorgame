/* hq :: model/wire
   What travels between the page and the worker that computes the truth of the
   world. The worker owns the engine; the page gets plain data and never waits
   for the engine inside a frame. */

export const SLOTS = ['A', 'B', 'C'] as const
export type Slot = (typeof SLOTS)[number]

export function slotIndex(slot: string): number {
  return slot === 'A' ? 0 : slot === 'B' ? 1 : slot === 'C' ? 2 : -1
}

export interface NeedleSite {
  q: number
  r: number
  start: string | null
  ring: boolean
  spoke: boolean
}

export interface MatchMeta {
  ticks: number
  /** nicks by slot A, B, C: the journal's hall */
  roster: string[]
  /** the valley needles of the manifest */
  needles: NeedleSite[]
  radius: number
  /** terrain cells that differ from the default: q, r, type index */
  cells: [number, number, number][]
  types: string[]
  seats: { q: number; r: number }[]
  citadel: { q: number; r: number }
  cherta: number
  dawnAt: number
  /** the gatekeeper's denial words by code (part2/04-protocol.md, 6.6) */
  denyWords: string[]
}

/** tick, slot index, bytes of the orders frame, commands in it */
export type FrameRow = [number, number, number, number]
/** slot index, tick, command number, denial code */
export type DenyRow = [number, number, number, number]
/** tick, cell, owner (a slot letter, K) or null */
export type OwnRow = [number, string, string | null]
/** tick, cell, whether the needle is lit */
export type LitRow = [number, string, boolean]
/** tick, unit name, owner, class, q, r, alive */
export type UnitRow = [number, string, string, string, number, number, boolean]

/** The truth of ticks from..to (inclusive) and the changes inside them. */
export interface TruthChunk {
  from: number
  to: number
  /** per tick: the score of A, B, C */
  score: Float64Array
  /** per tick: the lit needles of A, B, C */
  needles: Uint16Array
  own: OwnRow[]
  lit: LitRow[]
  units: UnitRow[]
  frames: FrameRow[]
  denies: DenyRow[]
}

/* a job is one match; its number comes back with every answer */
export type ToWorker =
  | { type: 'open'; job: number; runlog: ArrayBuffer }
  | { type: 'live'; job: number; manifest: ArrayBuffer; bots: string[]; roster: string[] }
  | { type: 'tick'; job: number; t: number; submits: [string, ArrayBuffer][]; denies: [string, number, number][] }

export type FromWorker =
  /* the worker has loaded and takes jobs */
  | { type: 'up' }
  /* framesTo: the last tick the channel is already known for - the whole match of a record, 0 of a live one */
  | { type: 'meta'; job: number; meta: MatchMeta; frames: FrameRow[]; denies: DenyRow[]; framesTo: number }
  | { type: 'chunk'; job: number; chunk: TruthChunk }
  | { type: 'done'; job: number }
  | { type: 'error'; job: number; why: string }
