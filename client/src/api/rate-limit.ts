import type { Clock } from './clock'

/**
 * Local mirror of the ether limit (client spec 5.6). The server keeps a token
 * bucket per address: 20 requests, one refilled every 3 s. We run a stricter
 * bucket so the client alone never trips it, and a gate that holds every
 * request to the server while it is jammed (CL-07): a request during a jam
 * doubles the jam.
 */

export type EtherPhase = 'static' | 'window' | 'after'

export interface BucketOptions {
  capacity: number
  refillMs: number
}

/** Stricter than the server (20 / 3000 ms) to leave room for a second tab or a manual curl. */
export const DEFAULT_BUCKET: BucketOptions = { capacity: 15, refillMs: 3_300 }

/** Extra wait after Retry-After: a request in the last second of a jam is still refused. */
export const GATE_MARGIN_MS = 1_000

export class TokenBucket {
  readonly #capacity: number
  readonly #refillMs: number
  #tokens: number
  #updatedAt: number

  constructor(options: BucketOptions, now: number) {
    this.#capacity = options.capacity
    this.#refillMs = options.refillMs
    this.#tokens = options.capacity
    this.#updatedAt = now
  }

  #refill(now: number): void {
    const elapsed = Math.max(0, now - this.#updatedAt)
    this.#tokens = Math.min(this.#capacity, this.#tokens + elapsed / this.#refillMs)
    this.#updatedAt = now
  }

  /** Takes a token and returns 0, or returns how long to wait for the next one. */
  take(now: number): number {
    this.#refill(now)
    if (this.#tokens >= 1) {
      this.#tokens -= 1
      return 0
    }
    // Float residue (1/3 of a token) must not add a millisecond to the wait
    return Math.ceil((1 - this.#tokens) * this.#refillMs - 1e-6)
  }

  available(now: number): number {
    this.#refill(now)
    return Math.floor(this.#tokens)
  }
}

const EXEMPT = new Set(['POST /auth/login', 'GET /ether/key', 'GET /openapi.json'])

/**
 * Whether a request is counted in the ether limit. Before the window every
 * /api/v1 request counts; in the window and after, only requests without
 * Authorization. Login, the station key, the contract and OPTIONS never count.
 * An unknown phase is treated as static: counting too much is the safe side.
 */
export function countsTowardEtherLimit(
  method: string,
  path: string,
  authorized: boolean,
  phase: EtherPhase | null,
): boolean {
  const upper = method.toUpperCase()
  if (upper === 'OPTIONS') return false
  const bare = path.split('?')[0] ?? path
  if (EXEMPT.has(`${upper} ${bare}`)) return false
  if (phase === 'window' || phase === 'after') return !authorized
  return true
}

/**
 * Where the jam gate outlives this limiter: a reload, the other server and
 * back, a second tab (CL-07 forbids any request until Retry-After ends).
 */
export interface SharedGate {
  load(): number
  save(until: number): void
}

export class EtherLimiter {
  readonly #clock: Clock
  readonly #bucket: TokenBucket
  readonly #shared: SharedGate | null
  #gateUntil = 0
  #phase: EtherPhase | null = null

  constructor(clock: Clock, options: BucketOptions = DEFAULT_BUCKET, shared: SharedGate | null = null) {
    this.#clock = clock
    this.#bucket = new TokenBucket(options, clock.now())
    this.#shared = shared
    this.#gateUntil = shared?.load() ?? 0
  }

  /** The later of our own hold and one set elsewhere (another tab, an earlier load of the page). */
  #until(): number {
    const shared = this.#shared?.load() ?? 0
    if (shared > this.#gateUntil) this.#gateUntil = shared
    return this.#gateUntil
  }

  get phase(): EtherPhase | null {
    return this.#phase
  }

  /** Set from a verified ether frame; decides which requests are counted. */
  setPhase(phase: EtherPhase | null): void {
    this.#phase = phase
  }

  /** Epoch ms until which nothing may be sent; 0 when open. */
  get gateUntil(): number {
    const until = this.#until()
    return until > this.#clock.now() ? until : 0
  }

  /** Holds all requests for Retry-After seconds plus a margin. Never shortens an existing hold. */
  hold(retryAfterSec: number): void {
    const until = this.#clock.now() + Math.max(0, retryAfterSec) * 1000 + GATE_MARGIN_MS
    this.#gateUntil = Math.max(this.#until(), until)
    this.#shared?.save(this.#gateUntil)
  }

  /** Waits for the gate and, if the request counts, for a token. Rejects only on abort. */
  async acquire(counts: boolean, signal?: AbortSignal): Promise<void> {
    for (;;) {
      signal?.throwIfAborted()
      const now = this.#clock.now()
      const until = this.#until()
      if (now < until) {
        await this.#clock.sleep(until - now, signal)
        continue
      }
      if (!counts) return
      const wait = this.#bucket.take(now)
      if (wait === 0) return
      await this.#clock.sleep(wait, signal)
    }
  }
}
