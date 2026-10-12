/* hq :: app/answers
   What the show says at the tick it stands on: one value per anchor of the
   contract (part3/01-hq-contract.md, 3.3). A pure function of the view and of
   what has been read so far; an empty value means "nothing to show yet" - the
   truth of this tick is still being computed or the file has not arrived. */

import type { BeliefIndex } from '../model/belief.ts'
import type { MatchIndex } from '../model/match.ts'
import { compare, comparedPair, slotOf, type PackEntry } from '../model/pack.ts'
import { SLOTS, slotIndex } from '../model/wire.ts'

export type Mode = 'truth' | 'belief' | 'both'

export interface LiveView {
  /** the last closed tick of the broadcast */
  cap: number
  ended: boolean
  /** the shares of this match, known at its end */
  shares: number[] | null
  /** nicks by slot A, B, C */
  roster: string[]
  /** the nick whose diary the broadcast carries */
  owner: string
}

export interface View {
  packId: string | null
  match: number
  tick: number
  mode: Mode
  focus: string
  cell: string
  unit: string
  order: number
  /** the answer to the latest promotion request: `-` before any, empty while waiting */
  promote: string
  live: LiveView | null
}

export interface Sources {
  packs: readonly PackEntry[]
  pack: PackEntry | null
  index: MatchIndex | null
  /** the diary of this match; null while it is loading or when the record has none */
  belief: BeliefIndex | null
}

export const ANCHORS = [
  'tick',
  'match',
  'mode',
  'focus',
  'cell',
  'cell-owner-truth',
  'cell-owner-belief',
  'ghost-cell',
  'ghost-age',
  'diff-count',
  'dark-count',
  'score',
  'needles',
  'shares',
  'bytes',
  'orders',
  'denied',
  'deny-word',
  'deny-top-tick',
  'ab-winner',
  'ab-diff',
  'ab-top',
  'promote-status',
  'live-lag',
  'live-state',
] as const

export type AnchorName = (typeof ANCHORS)[number]
export type Answers = Record<AnchorName, string>

const CELL = /^\s*(-?\d+)\s*,\s*(-?\d+)\s*$/

/** A cell as the contract writes it, `q,r`; empty for anything else. */
export function cellKey(raw: string): string {
  const m = CELL.exec(raw)
  return m ? `${Number(m[1])},${Number(m[2])}` : ''
}

export const fixed1 = (x: number): string => (Math.round(x * 10) / 10).toFixed(1)

/** The slot letter the focus holds in the match the view stands on. */
export function focusSlot(view: View, pack: PackEntry | null): string {
  if (view.live) return SLOTS[view.live.roster.indexOf(view.focus)] ?? ''
  if (!pack) return ''
  return slotOf(pack.pack, pack.pack.roster.indexOf(view.focus), view.match)
}

/** The nick whose belief diary lies in the record or comes with the broadcast. */
export function diaryOwner(view: View, pack: PackEntry | null): string {
  if (view.live) return view.live.owner
  const seat = pack?.pack.belief?.seat
  return seat === undefined ? '' : (pack?.pack.roster[seat] ?? '')
}

/* an actor of the world as an anchor value: a participant by nick, the Keeper by K, nobody by a dash */
function actor(who: string | null, roster: readonly string[]): string {
  if (who === null) return '-'
  const s = slotIndex(who)
  return s < 0 ? who : (roster[s] ?? who)
}

function blank(): Answers {
  const out = {} as Answers
  for (const name of ANCHORS) out[name] = ''
  return out
}

export function answers(view: View, src: Sources): Answers {
  const out = blank()
  const { index, belief, pack } = src
  const t = view.tick
  const live = view.live
  const cell = cellKey(view.cell)
  const slot = slotIndex(focusSlot(view, pack))
  const known = index !== null && index.known(t)
  /* the diary belongs to one participant: for another focus the record has no belief */
  const owner = diaryOwner(view, pack)
  const mine = owner !== '' && owner === view.focus

  out.tick = String(t)
  out.match = live ? '-' : String(view.match)
  out.mode = view.mode
  out.focus = view.focus
  out.cell = cell

  if (index && cell !== '' && known) out['cell-owner-truth'] = actor(index.ownerAt(cell, t), index.meta.roster)
  if (index && cell !== '') {
    if (!mine) out['cell-owner-belief'] = '?'
    else if (belief) {
      const who = belief.ownerAt(cell, t)
      out['cell-owner-belief'] = who === undefined ? '?' : actor(who, index.meta.roster)
    }
  }

  if (view.unit !== '' && (belief || !mine)) {
    const contact = mine && belief ? belief.contact(view.unit, t) : null
    out['ghost-cell'] = contact ? `${contact.q},${contact.r}` : '-'
    out['ghost-age'] = contact ? String(t - contact.t) : '-'
  }

  if (index && belief && mine) {
    let dark = 0
    let diff = 0
    for (const site of index.meta.needles) {
      const key = `${site.q},${site.r}`
      if (belief.darkAt(key, t)) dark += 1
      if (!known) continue
      const believed = belief.ownerAt(key, t)
      if (believed !== undefined && believed !== index.ownerAt(key, t)) diff += 1
    }
    out['dark-count'] = String(dark)
    if (known) out['diff-count'] = String(diff)
  }

  if (index && slot >= 0) {
    if (known) {
      out.score = fixed1(index.scoreAt(slot, t))
      out.needles = String(index.needlesAt(slot, t))
    }
    if (t <= index.framesTo) {
      out.bytes = String(index.bytesAt(slot, t))
      out.orders = String(index.ordersAt(slot, t))
      out.denied = String(index.deniesAt(slot, t).length)
      out['deny-word'] = index.denyWord(slot, t, view.order) ?? '-'
    }
    out['deny-top-tick'] = String(index.denyTopTick(slot))
  }

  if (live) out.shares = live.ended && live.shares ? live.shares.join(',') : ''
  else if (pack) out.shares = pack.pack.shares.join(',')

  const pair = comparedPair(src.packs)
  if (pair) {
    const cmp = compare(pair[0], pair[1], view.match)
    out['ab-winner'] = cmp.winner
    out['ab-diff'] = fixed1(cmp.diff)
    out['ab-top'] = cmp.top
  }

  out['promote-status'] = view.promote
  out['live-lag'] = live ? String(Math.max(0, live.cap - t)) : '-'
  out['live-state'] = live ? (live.ended ? 'end' : 'live') : '-'
  return out
}
