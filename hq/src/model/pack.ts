/* hq :: model/pack
   The pack summary (pack.json, part3/03-record.md) and what is read from
   summaries alone: whose diary lies in the record, which slot the focus holds
   in a match, and the comparison of two packs of one seed played by different
   presets (Ш4). */

import { isRecord } from './guards.ts'

export const SCORE_ITEMS = ['network', 'orders', 'stolen', 'pactTax'] as const
export type ScoreItem = (typeof SCORE_ITEMS)[number]

export type Breakdown = Readonly<Record<string, number>>

export interface PackMatch {
  file: string
  /** score items by slot letter */
  breakdown: Readonly<Record<string, Breakdown>>
}

export interface PackSummary {
  seed: number | null
  ticks: number
  shares: number[]
  /** score items over the pack, in the order of the hall */
  breakdown: Breakdown[]
  /** rotations[match][seat] is the slot letter */
  rotations: string[][]
  roster: string[]
  matches: PackMatch[]
  belief: { seat: number; files: string[] } | null
}

export interface PackEntry {
  id: string
  title: string
  preset: string
  pack: PackSummary
}

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const text = (v: unknown): string => (typeof v === 'string' ? v : '')

function numbers(v: unknown): Breakdown {
  const out: Record<string, number> = {}
  if (isRecord(v)) for (const [k, x] of Object.entries(v)) if (typeof x === 'number' && Number.isFinite(x)) out[k] = x
  return out
}

export function readPack(v: unknown): PackSummary | null {
  if (!isRecord(v) || !Array.isArray(v.roster) || !Array.isArray(v.matches)) return null
  const belief = isRecord(v.belief) && typeof v.belief.seat === 'number' ? { seat: v.belief.seat, files: list(v.belief.files).map(text) } : null
  return {
    seed: typeof v.seed === 'number' ? v.seed : null,
    ticks: typeof v.ticks === 'number' && v.ticks > 0 ? Math.floor(v.ticks) : 0,
    shares: list(v.shares).map((s) => (typeof s === 'number' ? s : 0)),
    breakdown: list(v.breakdown).map(numbers),
    rotations: list(v.rotations).map((r) => list(r).map(text)),
    roster: v.roster.map(text),
    matches: v.matches.map((m) => {
      const breakdown: Record<string, Breakdown> = {}
      if (isRecord(m) && isRecord(m.breakdown)) for (const [slot, b] of Object.entries(m.breakdown)) breakdown[slot] = numbers(b)
      return { file: isRecord(m) ? text(m.file) : '', breakdown }
    }),
    belief,
  }
}

export function readEntry(v: unknown): PackEntry | null {
  if (!isRecord(v) || typeof v.id !== 'string') return null
  const pack = readPack(v.pack)
  return pack ? { id: v.id, title: text(v.title) || v.id, preset: text(v.preset), pack } : null
}

/** The seat whose diary lies in the record; the first one when the record has no diary. */
export function focusSeat(pack: PackSummary): number {
  return pack.belief ? pack.belief.seat : 0
}

/** The slot letter of a seat in match `n` (1..3). */
export function slotOf(pack: PackSummary, seat: number, n: number): string {
  return pack.rotations[n - 1]?.[seat] ?? ''
}

export interface Comparison {
  /** the id of the record with more network minutes over the pack; the first one on a tie */
  winner: string
  /** the difference of the totals in the chosen match */
  diff: number
  /** the score item with the largest divergence in the chosen match */
  top: ScoreItem
  /** the total and the score items of the focus in the chosen match, side by side */
  rows: { item: string; a: number; b: number }[]
}

/**
 * The pair the comparison stands on: `preset-a` and `preset-b` when the host
 * supplied them (the acceptance material), otherwise the first two records of
 * one seed with different presets.
 */
export function comparedPair(packs: readonly PackEntry[]): [PackEntry, PackEntry] | null {
  const a = packs.find((p) => p.id === 'preset-a')
  const b = packs.find((p) => p.id === 'preset-b')
  if (a && b) return [a, b]
  for (const first of packs) {
    const second = packs.find((p) => p !== first && p.pack.seed === first.pack.seed && p.preset !== first.preset)
    if (second) return [first, second]
  }
  return null
}

export function compare(a: PackEntry, b: PackEntry, match: number): Comparison {
  const seatA = focusSeat(a.pack)
  const seatB = focusSeat(b.pack)
  const netA = a.pack.breakdown[seatA]?.network ?? 0
  const netB = b.pack.breakdown[seatB]?.network ?? 0
  const inA = a.pack.matches[match - 1]?.breakdown[slotOf(a.pack, seatA, match)] ?? {}
  const inB = b.pack.matches[match - 1]?.breakdown[slotOf(b.pack, seatB, match)] ?? {}
  let top: ScoreItem = SCORE_ITEMS[0]
  let most = -1
  for (const item of SCORE_ITEMS) {
    const gap = Math.abs((inA[item] ?? 0) - (inB[item] ?? 0))
    if (gap > most) {
      most = gap
      top = item
    }
  }
  return {
    winner: netA >= netB ? a.id : b.id,
    diff: Math.abs((inA.total ?? 0) - (inB.total ?? 0)),
    top,
    rows: ['total', ...SCORE_ITEMS].map((item) => ({ item, a: inA[item] ?? 0, b: inB[item] ?? 0 })),
  }
}
