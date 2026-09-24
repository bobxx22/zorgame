import { Backoff } from './backoff'
import { systemClock, type Clock } from './clock'
import { rawRequest, type FailureReason, type FetchLike, type Method, type RawResult } from './http'
import { countsTowardEtherLimit, EtherLimiter } from './rate-limit'
import { isRecord } from '../lib/guards'

/**
 * Typed calls to /api/v1 on top of rawRequest: every request passes the ether
 * limiter, 429 holds the gate, failures are retried by policy (CL-07, CL-09,
 * CL-36). Nothing here throws; the caller gets ApiResult.
 */

export interface RetryPolicy {
  /** Retry 5xx without an ether envelope, dropped connections and timeouts, with backoff. */
  transient: boolean
  /** Retry 429 authentication-busy after Retry-After: a busy queue, not a refusal. */
  busy: boolean
  maxAttempts: number
}

/** Reads and other idempotent calls. */
export const RETRY_IDEMPOTENT: RetryPolicy = { transient: true, busy: true, maxAttempts: 6 }
/** Calls with side effects: a lost answer is resolved by the caller (CL-17), never by a blind resend. */
export const RETRY_NON_IDEMPOTENT: RetryPolicy = { transient: false, busy: true, maxAttempts: 6 }

/** Hold used when a 429 carries no Retry-After. */
export const DEFAULT_HOLD_SEC = 60
/** Pause for authentication-busy without Retry-After (spec 5.5: 5 s). */
export const DEFAULT_BUSY_SEC = 5

export interface ErrorBody {
  code: string
  field: string | null
  requestId: string | null
}

export type ApiFailure =
  | {
      kind: 'http'
      status: number
      code: string | null
      field: string | null
      requestId: string | null
      retryAfterSec: number | null
      /** A sealed ether envelope in place of an answer: the station before the window, not an outage. */
      envelope: boolean
      text: string
    }
  | { kind: 'unexpected'; status: number; requestId: string | null; text: string }
  | { kind: 'network'; reason: FailureReason }

export type ApiResult<T> =
  | { ok: true; status: number; data: T; requestId: string | null }
  | { ok: false; error: ApiFailure }

export interface RequestOptions {
  method?: Method
  path: string
  query?: Record<string, string | number | undefined>
  body?: unknown
  token?: string | null
  signal?: AbortSignal
  timeoutMs?: number
}

export interface CallOptions<T> extends RequestOptions {
  /** Shape guard for a 2xx body; null means the body is not the expected object. */
  parse: (json: unknown) => T | null
  retry?: RetryPolicy
}

export interface ApiClientDeps {
  clock?: Clock
  fetch?: FetchLike
  random?: () => number
  limiter?: EtherLimiter
}


export function readError(json: { value: unknown } | null): ErrorBody | null {
  if (!json || !isRecord(json.value)) return null
  const error = json.value.error
  if (!isRecord(error) || typeof error.code !== 'string') return null
  return {
    code: error.code,
    field: typeof error.field === 'string' ? error.field : null,
    requestId: typeof error.requestId === 'string' ? error.requestId : null,
  }
}

/** Seal: Ed25519 signature in base64url without padding; key id: the first 16 hex of the key's SHA-256. */
export const SEAL_PATTERN = /^[A-Za-z0-9_-]{86}$/
export const KEY_ID_PATTERN = /^[0-9a-f]{16}$/

/** Form check only; the seal itself is verified by the ether module. */
export function looksLikeEnvelope(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.frame === 'string' &&
    typeof value.seal === 'string' &&
    SEAL_PATTERN.test(value.seal) &&
    typeof value.key === 'string' &&
    KEY_ID_PATTERN.test(value.key)
  )
}

export class ApiClient {
  readonly baseUrl: string
  readonly limiter: EtherLimiter
  readonly #clock: Clock
  readonly #fetch: FetchLike | undefined
  readonly #random: () => number

  constructor(baseUrl: string, deps: ApiClientDeps = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.#clock = deps.clock ?? systemClock
    this.#fetch = deps.fetch
    this.#random = deps.random ?? Math.random
    this.limiter = deps.limiter ?? new EtherLimiter(this.#clock)
  }

  url(path: string, query?: RequestOptions['query']): string {
    const params = new URLSearchParams()
    for (const [name, value] of Object.entries(query ?? {})) {
      if (value !== undefined) params.set(name, String(value))
    }
    const search = params.toString()
    return this.baseUrl + path + (search ? `?${search}` : '')
  }

  /** One request through the gate and the bucket; a 429 holds the gate. No retries. */
  async send(options: RequestOptions): Promise<RawResult> {
    const method = options.method ?? 'GET'
    const token = options.token ?? null
    const counts = countsTowardEtherLimit(method, options.path, token !== null, this.limiter.phase)
    try {
      await this.limiter.acquire(counts, options.signal)
    } catch {
      return { kind: 'failure', reason: 'aborted' }
    }

    const result = await rawRequest(
      {
        method,
        url: this.url(options.path, options.query),
        body: options.body,
        token,
        signal: options.signal,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      },
      this.#fetch,
      () => this.#clock.now(),
    )

    // 429 is never noise. jammed, rate-limited and unknown codes stop all traffic
    // for Retry-After; authentication-busy only delays the call that got it.
    if (result.kind === 'response' && result.status === 429) {
      if (readError(result.json)?.code !== 'authentication-busy') {
        this.limiter.hold(result.retryAfterSec ?? DEFAULT_HOLD_SEC)
      }
    }
    return result
  }

  async call<T>(options: CallOptions<T>): Promise<ApiResult<T>> {
    const method = options.method ?? 'GET'
    const policy = options.retry ?? (method === 'GET' ? RETRY_IDEMPOTENT : RETRY_NON_IDEMPOTENT)
    const backoff = new Backoff(this.#random)

    for (let attempt = 1; ; attempt += 1) {
      const result = await this.send(options)
      const canRetry = attempt < policy.maxAttempts

      if (result.kind === 'failure') {
        if (result.reason !== 'aborted' && policy.transient && canRetry) {
          if (await this.#pause(backoff.next(), options.signal)) continue
          return { ok: false, error: { kind: 'network', reason: 'aborted' } }
        }
        return { ok: false, error: { kind: 'network', reason: result.reason } }
      }

      const { status, requestId, retryAfterSec, text } = result
      const error = readError(result.json)

      if (status === 429 && error?.code === 'authentication-busy' && policy.busy && canRetry) {
        if (await this.#pause((retryAfterSec ?? DEFAULT_BUSY_SEC) * 1000, options.signal)) continue
        return { ok: false, error: { kind: 'network', reason: 'aborted' } }
      }

      const envelope = looksLikeEnvelope(result.json?.value)
      if (status >= 500 && !envelope && policy.transient && canRetry) {
        const pause = Math.max(backoff.next(), (retryAfterSec ?? 0) * 1000)
        if (await this.#pause(pause, options.signal)) continue
        return { ok: false, error: { kind: 'network', reason: 'aborted' } }
      }

      if (status >= 200 && status < 300) {
        const data = options.parse(result.json ? result.json.value : undefined)
        if (data !== null) return { ok: true, status, data, requestId }
        return { ok: false, error: { kind: 'unexpected', status, requestId, text } }
      }

      return {
        ok: false,
        error: {
          kind: 'http',
          status,
          code: error?.code ?? null,
          field: error?.field ?? null,
          requestId: requestId ?? error?.requestId ?? null,
          retryAfterSec,
          envelope,
          text,
        },
      }
    }
  }

  /** Sleeps; false when aborted. */
  async #pause(ms: number, signal?: AbortSignal): Promise<boolean> {
    try {
      await this.#clock.sleep(ms, signal)
      return true
    } catch {
      return false
    }
  }
}
