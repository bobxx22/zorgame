import { Backoff } from '../api/backoff'
import type { ApiResult, CallOptions } from '../api/client'
import { isAbortError, systemClock, type Clock } from '../api/clock'
import { parseRepositoryEnvelope, type Repository } from '../auth/schemas'
import type { EtherPhase } from '../ether/frame'
import { readAllPages } from './paging'
import {
  parseMessage,
  parseNews,
  parsePage,
  parseStage,
  parseStageList,
  parseSummary,
  wrapped,
  type Message,
  type News,
  type Stage,
  type StageSummary,
  type Summary,
} from './schemas'

/**
 * The participant's cabinet: polls the cheap summary about every 15 s and
 * rereads only what moved (CL-27): unread -> letters, then parts; latestNews ->
 * news; releasedStages -> parts; repositoryAt -> repository (CL-25). A list is
 * marked as read for a summary value only after it was read successfully, so a
 * failed reread is repeated on the next poll instead of being lost. Nothing is
 * asked while the station is in static: the server answers with noise then.
 */

export const SUMMARY_INTERVAL_MS = 15_000
export const SUMMARY_JITTER_MS = 2_000
/** When the phase is unknown the cabinet asks rarely: the answers may be noise. */
export const UNKNOWN_PHASE_INTERVAL_MS = 60_000

export type AuthCall = <T>(options: Omit<CallOptions<T>, 'token'>) => Promise<ApiResult<T>>

export interface CabinetSnapshot {
  summary: Summary | null
  inbox: readonly Message[] | null
  news: readonly News[] | null
  stages: readonly StageSummary[] | null
  stageBodies: Readonly<Record<string, Stage>>
  /** undefined: not read yet; null: no application. */
  repository: Repository | null | undefined
  /** The server answered with the ether instead of the API. */
  noise: boolean
  problem: string | null
  lastSyncMs: number | null
  polling: boolean
}

export interface CabinetOptions {
  call: AuthCall
  clock?: Clock
  random?: () => number
}

const initial: CabinetSnapshot = {
  summary: null,
  inbox: null,
  news: null,
  stages: null,
  stageBodies: {},
  repository: undefined,
  noise: false,
  problem: null,
  lastSyncMs: null,
  polling: false,
}

/** Calls with an effect: the poll does not repeat them blindly. */
const ONCE = { transient: false, busy: true, maxAttempts: 2 } as const
/** Reads: a dropped connection is simply asked again once. */
const READ = { transient: true, busy: true, maxAttempts: 2 } as const

const withSignal = (signal: AbortSignal | undefined) => (signal ? { signal } : {})

/** Summary values each list was last read for; absent until that list was read successfully. */
interface Synced {
  inbox?: number
  stages?: number
  news?: string | null
  repository?: string | null
}

export function describeFailure<T>(result: ApiResult<T>): string | null {
  if (result.ok) return null
  const { error } = result
  if (error.kind === 'network') return error.reason === 'timeout' ? 'Сервер не відповів вчасно.' : 'Немає зв’язку з сервером.'
  if (error.kind === 'unexpected') return 'Сервер відповів незрозуміло.'
  const id = error.requestId ? ` X-Request-Id: ${error.requestId}` : ''
  if (error.status === 429) return `Сервер просить зачекати ${String(error.retryAfterSec ?? 60)} с.`
  if (error.status >= 500) return `Збій сервера (${String(error.status)}).${id}`
  return `Помилка ${String(error.status)}${error.code ? ` ${error.code}` : ''}.${id}`
}

function isNoise<T>(result: ApiResult<T>): boolean {
  return !result.ok && result.error.kind === 'http' && result.error.envelope
}

function isAuthLost<T>(result: ApiResult<T>): boolean {
  return !result.ok && result.error.kind === 'http' && result.error.status === 401
}

function isAborted<T>(result: ApiResult<T>): boolean {
  return !result.ok && result.error.kind === 'network' && result.error.reason === 'aborted'
}

export class CabinetStore {
  readonly #call: AuthCall
  readonly #clock: Clock
  readonly #random: () => number
  readonly #backoff: Backoff
  readonly #listeners = new Set<() => void>()
  #snapshot: CabinetSnapshot = initial
  #run: AbortController | null = null
  #phase: EtherPhase | null = null
  #synced: Synced = {}

  constructor(options: CabinetOptions) {
    this.#call = options.call
    this.#clock = options.clock ?? systemClock
    this.#random = options.random ?? Math.random
    this.#backoff = new Backoff(this.#random)
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  getSnapshot = (): CabinetSnapshot => this.#snapshot

  setPhase(phase: EtherPhase | null): void {
    this.#phase = phase
  }

  start(): void {
    if (this.#run) return
    const run = new AbortController()
    this.#run = run
    this.#update({ polling: true })
    void this.#loop(run.signal)
  }

  stop(): void {
    this.#run?.abort()
    this.#run = null
    this.#update({ polling: false })
  }

  /** One poll of the summary and whatever it says has moved; returns the pause before the next. */
  async tick(signal?: AbortSignal): Promise<number> {
    const base = SUMMARY_INTERVAL_MS + Math.floor(this.#random() * SUMMARY_JITTER_MS)
    if (this.#phase === 'static') {
      this.#update({ noise: true })
      return base
    }

    const result = await this.#call({ path: '/me/summary', parse: parseSummary, retry: READ, ...withSignal(signal) })
    if (!result.ok) {
      if (isNoise(result)) {
        this.#update({ noise: true })
        return base
      }
      if (isAuthLost(result) || isAborted(result)) return base
      this.#update({ problem: describeFailure(result) })
      return Math.max(base, this.#backoff.next())
    }

    this.#backoff.reset()
    const next = result.data
    this.#update({ summary: next, noise: false, problem: null, lastSyncMs: this.#clock.now() })

    // Compared with what each list was last read for, not with the previous summary:
    // a reread that failed stays due until it succeeds.
    const synced = this.#synced
    const inboxDue = synced.inbox !== next.unread
    if (inboxDue && (await this.refreshInbox(signal))) synced.inbox = next.unread
    // A new part comes with a letter, so a moved inbox rereads the parts too.
    if ((inboxDue || synced.stages !== next.releasedStages) && (await this.refreshStages(signal))) {
      synced.stages = next.releasedStages
    }
    if (synced.news !== next.latestNews && (await this.refreshNews(signal))) synced.news = next.latestNews
    if (synced.repository !== next.repositoryAt && (await this.refreshRepository(signal))) {
      synced.repository = next.repositoryAt
    }

    return this.#phase === null ? Math.max(base, UNKNOWN_PHASE_INTERVAL_MS) : base
  }

  async refreshInbox(signal = this.#run?.signal): Promise<boolean> {
    const pages = await readAllPages((offset, limit) =>
      this.#call({
        path: '/inbox',
        query: { limit, offset },
        parse: parsePage(parseMessage),
        retry: READ,
        ...withSignal(signal),
      }),
    )
    if (pages.ok) this.#update({ inbox: pages.items })
    else this.#fail(pages.result)
    return pages.ok
  }

  async refreshNews(signal = this.#run?.signal): Promise<boolean> {
    const pages = await readAllPages((offset, limit) =>
      this.#call({
        path: '/news',
        query: { limit, offset },
        parse: parsePage(parseNews),
        retry: READ,
        ...withSignal(signal),
      }),
    )
    if (pages.ok) this.#update({ news: pages.items })
    else this.#fail(pages.result)
    return pages.ok
  }

  /** A moved errataAt is the signal to reread that part (CL-31). */
  async refreshStages(signal = this.#run?.signal): Promise<boolean> {
    const result = await this.#call({ path: '/stages', parse: parseStageList, retry: READ, ...withSignal(signal) })
    if (!result.ok) {
      this.#fail(result)
      return false
    }
    const stages = [...result.data].sort((a, b) => a.position - b.position)
    this.#update({ stages })
    for (const stage of stages) {
      const cached = this.#snapshot.stageBodies[stage.id]
      if (cached && cached.errataAt !== stage.errataAt) await this.openStage(stage.id, true)
    }
    return true
  }

  async refreshRepository(signal = this.#run?.signal): Promise<boolean> {
    const result = await this.#call({
      path: '/me/repository',
      parse: parseRepositoryEnvelope,
      retry: READ,
      ...withSignal(signal),
    })
    if (result.ok) this.#update({ repository: result.data.repository })
    else this.#fail(result)
    return result.ok
  }

  /** Full text of a part; a part not released yet answers 404, and nothing is guessed (CL-32). */
  async openStage(id: string, force = false): Promise<Stage | 'missing' | null> {
    const cached = this.#snapshot.stageBodies[id]
    if (cached && !force) return cached
    const result = await this.#call({
      path: `/stages/${encodeURIComponent(id)}`,
      parse: wrapped('stage', parseStage),
      retry: READ,
      ...withSignal(this.#run?.signal),
    })
    if (result.ok) {
      this.#update({ stageBodies: { ...this.#snapshot.stageBodies, [id]: result.data } })
      return result.data
    }
    if (result.error.kind === 'http' && result.error.status === 404) return 'missing'
    this.#fail(result)
    return null
  }

  /** Reading a letter does not mark it; this does (CL-29). */
  async markRead(id: string): Promise<void> {
    const result = await this.#call({
      method: 'POST',
      path: `/inbox/${encodeURIComponent(id)}/read`,
      body: {},
      parse: wrapped('message', parseMessage),
      retry: ONCE,
      ...withSignal(this.#run?.signal),
    })
    if (!result.ok) {
      this.#fail(result)
      return
    }
    const message = result.data
    const inbox = this.#snapshot.inbox?.map((m) => (m.id === message.id ? message : m)) ?? null
    const summary = this.#snapshot.summary
    const wasUnread = this.#snapshot.inbox?.find((m) => m.id === id)?.readAt === null
    const nextSummary = summary && wasUnread ? { ...summary, unread: Math.max(0, summary.unread - 1) } : summary
    // The list already matches the new counter: our own change needs no reread.
    if (nextSummary && this.#synced.inbox !== undefined) this.#synced.inbox = nextSummary.unread
    this.#update({ inbox, summary: nextSummary })
  }

  /** Receipt of a part is an explicit act of the participant (CL-33). */
  async acknowledge(id: string): Promise<boolean> {
    const result = await this.#call({
      method: 'POST',
      path: `/stages/${encodeURIComponent(id)}/ack`,
      body: {},
      parse: wrapped('stage', parseStage),
      retry: ONCE,
      ...withSignal(this.#run?.signal),
    })
    if (!result.ok) {
      this.#fail(result)
      return false
    }
    const stage = result.data
    const wasPending = this.#snapshot.stages?.find((s) => s.id === id)?.acknowledgedAt === null
    const stages =
      this.#snapshot.stages?.map((s) => (s.id === stage.id ? { ...s, acknowledgedAt: stage.acknowledgedAt } : s)) ??
      null
    const summary = this.#snapshot.summary
    this.#update({
      stages,
      stageBodies: { ...this.#snapshot.stageBodies, [stage.id]: stage },
      summary: summary && wasPending ? { ...summary, acknowledgedStages: summary.acknowledgedStages + 1 } : summary,
    })
    return true
  }

  setRepository(repository: Repository | null): void {
    this.#update({ repository })
  }

  async #loop(signal: AbortSignal): Promise<void> {
    try {
      while (!signal.aborted) {
        let delay: number
        try {
          delay = await this.tick(signal)
        } catch (error) {
          if (isAbortError(error)) return
          this.#update({ problem: error instanceof Error ? error.message : 'Помилка кабінету.' })
          delay = Math.max(SUMMARY_INTERVAL_MS, this.#backoff.next())
        }
        await this.#clock.sleep(delay, signal)
      }
    } catch (error) {
      if (!isAbortError(error)) this.#update({ problem: 'Опитування кабінету зупинилося.', polling: false })
    }
  }

  #fail<T>(result: ApiResult<T>): void {
    if (isNoise(result)) this.#update({ noise: true })
    else if (!isAuthLost(result) && !isAborted(result)) this.#update({ problem: describeFailure(result) })
  }

  #update(patch: Partial<CabinetSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...patch }
    for (const listener of this.#listeners) listener()
  }
}
