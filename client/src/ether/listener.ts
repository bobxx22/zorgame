import { Backoff } from '../api/backoff'
import { readError, type ApiClient } from '../api/client'
import { isAbortError, systemClock, type Clock } from '../api/clock'
import { receive, type NoiseReason } from './frame'
import { loadStationKey, type KeyProblem, type StationKey } from './seal'
import { applyFrame, initialStation, restoreLetter, storedLetter, type StationState } from './station'

/**
 * Listens to the ether: GET /ether no more often than every 15 s, the roll
 * no more often than once a minute and only while someone looks at it (CL-08).
 * Acts only on verified frames (CL-02); failures back off with jitter (CL-09);
 * a jam is waited out by the API client's gate (CL-07).
 */

export const ETHER_INTERVAL_MS = 15_000
export const ROLL_INTERVAL_MS = 60_000
/** Random extra pause so clients behind one address do not poll in lockstep. */
export const POLL_JITTER_MS = 3_000
/** An unknown key id re-reads GET /ether/key at most this often (spec 5.2: once). */
export const KEY_REFETCH_MS = 60_000
export const LOG_SIZE = 60

export type Route = '/ether' | '/ether/roll' | '/ether/key'

export type Outcome =
  | 'signal'
  | 'echo'
  | Exclude<NoiseReason, 'broken'>
  | 'broken'
  | 'no-envelope'
  | 'jammed'
  | 'rate-limited'
  | 'network'
  | 'timeout'
  | 'key-ok'
  | 'key-rejected'
  | 'key-failed'

export interface LogEntry {
  id: number
  atMs: number
  route: Route
  outcome: Outcome
  status: number | null
  detail: string | null
}

export interface KeyInfo {
  id: string
  fingerprint: string
  /** Matched against the fingerprint published in the task text. */
  pinned: boolean
  /** Unpinned key differs from the one seen before on this device. */
  changed: boolean
}

export interface EtherSnapshot {
  listening: boolean
  station: StationState
  key: KeyInfo | null
  keyProblem: KeyProblem | 'unavailable' | null
  log: readonly LogEntry[]
  counts: Readonly<Partial<Record<Outcome, number>>>
  nextPollAtMs: number | null
  failureStreak: number
}

/** The last accepted GET /ether/key body, kept per server (CL-04: read once, store). */
export interface KeyStore {
  load(): unknown
  save(body: unknown): void
}

export interface EtherListenerOptions {
  api: ApiClient
  keyStore: KeyStore
  pinnedFingerprint: string | null
  /** Where the Keeper's letter is kept between visits; same shape as the key store. */
  letterStore?: KeyStore
  clock?: Clock
  random?: () => number
}

const initialSnapshot: EtherSnapshot = {
  listening: false,
  station: initialStation,
  key: null,
  keyProblem: null,
  log: [],
  counts: {},
  nextPollAtMs: null,
  failureStreak: 0,
}

export class EtherListener {
  readonly #api: ApiClient
  readonly #keyStore: KeyStore
  readonly #letterStore: KeyStore | null
  readonly #pinned: string | null
  readonly #clock: Clock
  readonly #random: () => number
  readonly #backoff: Backoff
  readonly #listeners = new Set<() => void>()

  #snapshot: EtherSnapshot = initialSnapshot
  #run: AbortController | null = null
  #key: StationKey | null = null
  #lastKeyFetchMs = Number.NEGATIVE_INFINITY
  #rollWanted = 0
  #nextRollAtMs = 0
  #logId = 0

  constructor(options: EtherListenerOptions) {
    this.#api = options.api
    this.#keyStore = options.keyStore
    this.#letterStore = options.letterStore ?? null
    this.#pinned = options.pinnedFingerprint
    if (this.#letterStore) {
      this.#snapshot = { ...this.#snapshot, station: restoreLetter(initialStation, this.#letterStore.load()) }
    }
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

  getSnapshot = (): EtherSnapshot => this.#snapshot

  start(): void {
    if (this.#run) return
    const run = new AbortController()
    this.#run = run
    this.#update({ listening: true })
    void this.#loop(run.signal)
  }

  stop(): void {
    this.#run?.abort()
    this.#run = null
    this.#update({ listening: false, nextPollAtMs: null })
  }

  /** Asks for the roll while the caller needs it; returns the release. */
  wantRoll(): () => void {
    this.#rollWanted += 1
    if (this.#rollWanted === 1) this.#nextRollAtMs = 0
    let released = false
    return () => {
      if (released) return
      released = true
      this.#rollWanted -= 1
    }
  }

  /** Loads the stored key or reads it from the server. */
  async prepareKey(signal?: AbortSignal): Promise<void> {
    if (this.#key) return
    const stored = this.#keyStore.load()
    if (stored !== null) {
      const result = await loadStationKey(stored, this.#pinned)
      if (result.ok) {
        this.#setKey(result.key, false)
        return
      }
    }
    await this.#fetchKey(signal)
  }

  /** One polling cycle; returns the pause before the next one. */
  async tick(signal?: AbortSignal): Promise<number> {
    const healthy = await this.#poll('/ether', signal)
    if (this.#rollWanted > 0 && this.#clock.now() >= this.#nextRollAtMs) {
      this.#nextRollAtMs = this.#clock.now() + ROLL_INTERVAL_MS + this.#jitter()
      await this.#poll('/ether/roll', signal)
    }
    const base = ETHER_INTERVAL_MS + this.#jitter()
    if (healthy) {
      this.#backoff.reset()
    } else {
      const pause = Math.max(base, this.#backoff.next())
      this.#update({ failureStreak: this.#backoff.streak })
      return pause
    }
    this.#update({ failureStreak: 0 })
    return base
  }

  async #loop(signal: AbortSignal): Promise<void> {
    try {
      await this.prepareKey(signal)
      while (!signal.aborted) {
        let delay: number
        try {
          delay = await this.tick(signal)
        } catch (error) {
          if (isAbortError(error)) return
          this.#log('/ether', 'network', null, error instanceof Error ? error.message : 'error')
          delay = Math.max(ETHER_INTERVAL_MS, this.#backoff.next())
        }
        this.#update({ nextPollAtMs: this.#clock.now() + delay })
        await this.#clock.sleep(delay, signal)
      }
    } catch (error) {
      if (!isAbortError(error)) {
        this.#log('/ether', 'network', null, error instanceof Error ? error.message : 'error')
        this.stop()
      }
    }
  }

  #jitter(): number {
    return Math.floor(this.#random() * POLL_JITTER_MS)
  }

  /** Polls one ether route; false means a failure that should back off. */
  async #poll(route: '/ether' | '/ether/roll', signal?: AbortSignal): Promise<boolean> {
    const result = await this.#api.send({ path: route, ...(signal ? { signal } : {}) })
    const receivedAtMs = this.#clock.now()

    if (result.kind === 'failure') {
      if (result.reason === 'aborted') return true
      this.#log(route, result.reason, null, null)
      return false
    }

    if (result.status === 429) {
      const code = readError(result.json)?.code ?? null
      this.#log(route, code === 'jammed' ? 'jammed' : 'rate-limited', 429, code)
      return true
    }

    const reception = await receive(result.text, (id) => this.#keyFor(id, signal))
    if (reception.kind === 'signal') {
      const previous = this.#snapshot.station
      const station = applyFrame(previous, reception.frame, receivedAtMs)
      const newest = station.latest === reception.frame
      if (newest) this.#api.limiter.setPhase(reception.frame.phase)
      if (station.fragments !== previous.fragments) this.#letterStore?.save(storedLetter(station))
      this.#update({ station })
      const { phase, damaged } = reception.frame
      const detail = damaged.length > 0 ? `${phase}, без: ${damaged.join(', ')}` : phase
      this.#log(route, newest ? 'signal' : 'echo', result.status, detail)
      return true
    }

    const outcome: Outcome =
      reception.reason === 'broken' ? (result.json === null ? 'broken' : 'no-envelope') : reception.reason
    this.#log(route, outcome, result.status, readError(result.json)?.code ?? null)
    // 5xx without an envelope is an outage, not the station talking (CL-09)
    return !(result.status >= 500 && reception.reason === 'broken')
  }

  async #keyFor(id: string, signal?: AbortSignal): Promise<CryptoKey | null> {
    if (this.#key?.id === id) return this.#key.cryptoKey
    if (this.#clock.now() - this.#lastKeyFetchMs < KEY_REFETCH_MS) return null
    await this.#fetchKey(signal)
    return this.#key?.id === id ? this.#key.cryptoKey : null
  }

  async #fetchKey(signal?: AbortSignal): Promise<void> {
    this.#lastKeyFetchMs = this.#clock.now()
    const result = await this.#api.send({ path: '/ether/key', ...(signal ? { signal } : {}) })
    if (result.kind === 'failure') {
      if (result.reason === 'aborted') return
      this.#log('/ether/key', 'key-failed', null, result.reason)
      if (!this.#key) this.#update({ keyProblem: 'unavailable' })
      return
    }
    if (result.status !== 200 || !result.json) {
      this.#log('/ether/key', 'key-failed', result.status, readError(result.json)?.code ?? null)
      if (!this.#key) this.#update({ keyProblem: 'unavailable' })
      return
    }
    const loaded = await loadStationKey(result.json.value, this.#pinned)
    if (!loaded.ok) {
      this.#log('/ether/key', 'key-rejected', result.status, loaded.problem)
      this.#update({ keyProblem: loaded.problem })
      return
    }
    const previous = this.#key?.fingerprint ?? this.#storedFingerprint()
    this.#keyStore.save(result.json.value)
    this.#setKey(loaded.key, previous !== null && previous !== loaded.key.fingerprint)
    this.#log('/ether/key', 'key-ok', result.status, loaded.key.id)
  }

  #storedFingerprint(): string | null {
    const stored = this.#keyStore.load()
    if (typeof stored !== 'object' || stored === null) return null
    const fingerprint = (stored as { fingerprint?: unknown }).fingerprint
    return typeof fingerprint === 'string' ? fingerprint.toLowerCase() : null
  }

  #setKey(key: StationKey, changed: boolean): void {
    this.#key = key
    this.#update({
      key: { id: key.id, fingerprint: key.fingerprint, pinned: this.#pinned !== null, changed },
      keyProblem: null,
    })
  }

  #log(route: Route, outcome: Outcome, status: number | null, detail: string | null): void {
    this.#logId += 1
    const entry: LogEntry = { id: this.#logId, atMs: this.#clock.now(), route, outcome, status, detail }
    const counts = { ...this.#snapshot.counts, [outcome]: (this.#snapshot.counts[outcome] ?? 0) + 1 }
    this.#update({ log: [entry, ...this.#snapshot.log].slice(0, LOG_SIZE), counts })
  }

  #update(patch: Partial<EtherSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...patch }
    for (const listener of this.#listeners) listener()
  }
}
