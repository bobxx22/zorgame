import { isRecord } from '../lib/guards'

/**
 * The cabinet of parts 3 and 4: the submission (GET /me/stack, part4/01-submit.md 4.1)
 * and one's own games with their records (GET /me/games, /me/games/{id}/pack,
 * part3/03-record.md 6.1). The public contract (OpenAPI 1.1.0) does not carry these
 * routes yet, so the readers take the documented fields and keep the rest of the
 * answer as is: a field named differently is shown raw instead of being lost.
 */

export interface Check {
  name: string
  ok: boolean
  detail: string
}

export interface StackVerdict {
  id: string
  sha: string
  digest: string
  at: string | null
  ok: boolean
  checks: Check[]
}

export interface SubmitWindow {
  id: string
  title: string
  freezeAt: string | null
  retryUntil: string | null
  /** ahead - before the lock-in, retry - the resubmission window is on, past */
  phase: string
}

export interface Submission {
  kind: string
  auto: boolean
  requestedAt: string | null
  sha: string | null
  state: string
}

export interface Stack {
  /** ok, failed or none */
  status: string
  latest: StackVerdict | null
  history: StackVerdict[]
  nextGameAt: string | null
  window: SubmitWindow | null
  submissions: Submission[]
  retry: { available: boolean; used: boolean; until: string | null } | null
}

const text = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const textOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

function parseVerdict(v: unknown): StackVerdict | null {
  if (!isRecord(v)) return null
  return {
    id: text(v.id),
    sha: text(v.sha),
    digest: text(v.digest),
    at: textOrNull(v.at),
    ok: v.ok === true,
    checks: list(v.checks).flatMap((c) => (isRecord(c) && typeof c.name === 'string' ? [{ name: c.name, ok: c.ok === true, detail: text(c.detail) }] : [])),
  }
}

export function parseStack(v: unknown): Stack | null {
  if (!isRecord(v) || typeof v.status !== 'string') return null
  const submit = isRecord(v.submit) ? v.submit : null
  const w = submit && isRecord(submit.window) ? submit.window : null
  const r = submit && isRecord(submit.retry) ? submit.retry : null
  return {
    status: v.status,
    latest: parseVerdict(v.latest),
    history: list(v.history).flatMap((h) => {
      const parsed = parseVerdict(h)
      return parsed ? [parsed] : []
    }),
    nextGameAt: textOrNull(v.nextGameAt),
    window: w ? { id: text(w.id), title: text(w.title), freezeAt: textOrNull(w.freezeAt), retryUntil: textOrNull(w.retryUntil), phase: text(w.phase) } : null,
    submissions: list(submit?.submissions).flatMap((s) =>
      isRecord(s) ? [{ kind: text(s.kind), auto: s.auto === true, requestedAt: textOrNull(s.requestedAt), sha: textOrNull(s.sha), state: text(s.state) }] : [],
    ),
    retry: r ? { available: r.available === true, used: r.used === true, until: textOrNull(r.until) } : null,
  }
}

/* ===== games ===== */

/**
 * One game of GET /me/games as the network answers (seen 11.10.2026): `round` and `roundTitle`,
 * `group` and `lane` counted from 0, `startsAt` (null until the network names the hour),
 * `state` (`scheduled`, `played`), `opponents` as {username, displayName}, and for a played
 * pack `result` with our `share` and the pack's `shares` in the order of the trio.
 */
export interface GameRow {
  id: string
  /** the start of the pack's slot; null while the network has not named it */
  at: string | null
  /** the round in words, the group and the lane counted from 1 - as letters and the schedule count them */
  title: string
  /** the server's word: scheduled, played, ... */
  state: string
  opponents: string[]
  /** the pack's result in words: our share and the pack's shares, or a place; empty before the result */
  result: string
  raw: Record<string, unknown>
}

const first = (v: Record<string, unknown>, keys: readonly string[]): unknown => {
  for (const k of keys) if (v[k] !== undefined && v[k] !== null) return v[k]
  return undefined
}

const nameOf = (v: unknown): string =>
  typeof v === 'string' ? v : isRecord(v) ? text(first(v, ['displayName', 'nick', 'name', 'username', 'login', 'id'])) : ''

/* a rival as people know them: the display name, and the login next to it when it differs */
function rivalOf(v: unknown): string {
  const name = nameOf(v)
  const login = isRecord(v) ? text(first(v, ['username', 'login', 'member'])) : ''
  return login !== '' && name !== '' && login !== name ? `${name} (${login})` : name
}

/* the answer counts groups and lanes from 0, people count them from 1 */
const ordinal = (v: unknown): string => (typeof v === 'number' ? String(v + 1) : text(v))

function resultOf(v: Record<string, unknown>): string {
  const r = first(v, ['result', 'pack', 'outcome'])
  const src = isRecord(r) ? r : v
  const share = first(src, ['share', 'myShare', 'yourShare'])
  const shares = first(src, ['shares'])
  const parts: string[] = []
  if (typeof share === 'number') parts.push(`частка ${String(share)}`)
  if (Array.isArray(shares)) parts.push(`частки ${shares.map((s) => text(s)).join(' / ')}`)
  const place = first(src, ['place'])
  if (typeof place === 'number') parts.push(`місце ${String(place)}`)
  if (parts.length === 0 && typeof r === 'string') parts.push(r)
  return parts.join(', ')
}

function parseGame(v: unknown): GameRow | null {
  if (!isRecord(v)) return null
  const id = text(first(v, ['id', 'gameId', 'packId']))
  if (!id) return null
  const round = first(v, ['round', 'circle'])
  const group = first(v, ['group'])
  const lane = first(v, ['lane'])
  const title = [
    text(first(v, ['roundTitle'])) || (round === undefined ? '' : `коло ${text(round)}`),
    group === undefined ? '' : `група ${ordinal(group)}`,
    lane === undefined ? '' : `доріжка ${ordinal(lane)}`,
  ]
    .filter(Boolean)
    .join(', ')
  return {
    id,
    at: textOrNull(first(v, ['startsAt', 'at', 'startedAt', 'startAt', 'playedAt', 'time'])),
    title: title || text(first(v, ['title', 'name'])),
    state: text(first(v, ['state', 'status'])),
    opponents: list(first(v, ['opponents', 'rivals', 'vs'])).map(rivalOf).filter(Boolean),
    result: resultOf(v),
    raw: v,
  }
}

/** A list as an array, {items} (the network's paging) or {games}; `raw` is the answer as it came. */
export function parseGames(v: unknown): { items: GameRow[]; skipped: number; raw: unknown } | null {
  const raw = Array.isArray(v) ? v : isRecord(v) ? (Array.isArray(v.items) ? v.items : Array.isArray(v.games) ? v.games : null) : null
  if (!raw) return null
  const items: GameRow[] = []
  let skipped = 0
  for (const g of raw) {
    const parsed = parseGame(g)
    if (parsed) items.push(parsed)
    else skipped += 1
  }
  return { items, skipped, raw: v }
}

/* ===== one pack ===== */

export interface RecordFile {
  file: string
  bytes: number | null
  sha256: string | null
  receivedAt: string | null
  /** журнал, щоденник, ... - as the server names it */
  kind: string
  mine: boolean
}

export interface PackMatch {
  file: string
  score: Record<string, number>
}

/**
 * pack.json of the pack (part3/03-record.md 6.2), indexed by participant in roster order:
 * rotations[match][participant] is the slot, shareParts[participant][match] the share it took,
 * absent[participant][match] - the seat that never took the oath, wire[participant][match] -
 * the node's counters of that seat's wire (`missed` - ticks answered after the deadline or not
 * at all, `garbage`, `phantom`, `badResume` - the anomalies of scoring 8.3).
 */
export interface PackSummary {
  shares: number[]
  shareParts: number[][]
  absent: boolean[][]
  wire: Record<string, number>[][]
  roster: string[]
  rotations: string[][]
  matches: PackMatch[]
  seed: number | null
  ticks: number | null
}

export interface PackView {
  pack: PackSummary | null
  /** the summary as the server gave it: saved next to the records it is their pack.json */
  summary: Record<string, unknown> | null
  records: RecordFile[]
  raw: Record<string, unknown>
}

/* the counters of one seat in one match that are not zero */
function counters(v: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (isRecord(v)) for (const [name, n] of Object.entries(v)) if (typeof n === 'number' && n !== 0) out[name] = n
  return out
}

function parseSummary(v: unknown): PackSummary | null {
  if (!isRecord(v) || !Array.isArray(v.shares)) return null
  return {
    shares: v.shares.map((s) => (typeof s === 'number' ? s : 0)),
    shareParts: list(v.shareParts).map((r) => list(r).map((s) => (typeof s === 'number' ? s : 0))),
    absent: list(v.absent).map((r) => list(r).map((a) => a === true)),
    wire: list(v.wire).map((r) => list(r).map(counters)),
    roster: list(v.roster).map(nameOf),
    rotations: list(v.rotations).map((r) => list(r).map(text)),
    matches: list(v.matches).flatMap((m) =>
      isRecord(m)
        ? [{ file: text(m.file), score: isRecord(m.score) ? Object.fromEntries(Object.entries(m.score).map(([k, s]) => [k, typeof s === 'number' ? s : 0])) : {} }]
        : [],
    ),
    seed: typeof v.seed === 'number' ? v.seed : null,
    ticks: typeof v.ticks === 'number' ? v.ticks : null,
  }
}

export function parsePackView(v: unknown): PackView | null {
  if (!isRecord(v)) return null
  /* the network puts the summary under `summary` (and the pack's name under `pack`); a local pack.json is the summary itself */
  const source = [v.summary, v.pack, v].find((x) => isRecord(x) && Array.isArray(x.shares))
  const pack = parseSummary(source)
  const records = list(first(v, ['records', 'files'])).flatMap((r) =>
    isRecord(r) && typeof r.file === 'string'
      ? [
          {
            file: r.file,
            bytes: typeof r.bytes === 'number' ? r.bytes : null,
            sha256: textOrNull(r.sha256),
            receivedAt: textOrNull(r.receivedAt),
            kind: text(r.kind),
            mine: r.mine === true,
          },
        ]
      : [],
  )
  return { pack, summary: isRecord(source) ? source : null, records, raw: v }
}

/** The names of the eleven stages of the run in the interface's language (part4/03-preflight.md 2) */
export const STAGE_NAMES: Readonly<Record<string, string>> = {
  repo: 'репозиторій',
  secrets: 'секрети',
  nakaz: 'наказ',
  lang: 'мова бота',
  stack: 'стек',
  build: 'збірка',
  up: 'підйом',
  hello: 'присяга',
  health: '/health',
  metrics: '/metrics',
  'hq-bundle': 'штаб',
}
