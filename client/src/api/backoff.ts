/**
 * Exponential backoff with full jitter (CL-09):
 * pause = random in [0, min(cap, base * 2^n)), n = consecutive failures.
 */

export const BACKOFF_BASE_MS = 1_000
export const BACKOFF_CAP_MS = 60_000

export function backoffCeiling(attempt: number, baseMs = BACKOFF_BASE_MS, capMs = BACKOFF_CAP_MS): number {
  // 2^6 already exceeds the cap; clamp the exponent so large n never overflows
  return Math.min(capMs, baseMs * 2 ** Math.min(Math.max(0, attempt), 30))
}

export function fullJitter(attempt: number, random: () => number = Math.random): number {
  return Math.floor(random() * backoffCeiling(attempt))
}

/** Failure streak shared by a polling loop; reset after any successful response. */
export class Backoff {
  #streak = 0
  readonly #random: () => number

  constructor(random: () => number = Math.random) {
    this.#random = random
  }

  get streak(): number {
    return this.#streak
  }

  /** Pause before the next retry; grows the streak. */
  next(): number {
    const pause = fullJitter(this.#streak, this.#random)
    this.#streak += 1
    return pause
  }

  reset(): void {
    this.#streak = 0
  }
}
