import { abortReason, type Clock } from './clock'
import type { FetchLike } from './http'

/** Clock whose sleep advances time instantly and records every pause. */
export class FakeClock implements Clock {
  current: number
  readonly sleeps: number[] = []

  constructor(start = Date.UTC(2026, 8, 24, 9, 0, 0)) {
    this.current = start
  }

  now(): number {
    return this.current
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortReason(signal))
    this.sleeps.push(ms)
    this.current += Math.max(0, ms)
    return Promise.resolve()
  }
}

export interface RecordedCall {
  url: string
  init: RequestInit
  at: number
}

type Reply = Response | Error | ((init: RequestInit) => Promise<Response>)

/** fetch that plays back replies in order and records requests with the fake time. */
export function scriptedFetch(clock: Clock, replies: Reply[]): { fetch: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const queue = [...replies]
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, init, at: clock.now() })
    const reply = queue.shift()
    if (reply === undefined) return Promise.reject(new Error(`unexpected request ${url}`))
    if (reply instanceof Error) return Promise.reject(reply)
    if (typeof reply === 'function') return reply(init)
    return Promise.resolve(reply)
  }
  return { fetch, calls }
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

export function text(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : body, { status, headers })
}

export function headerOf(call: RecordedCall | undefined, name: string): string | null {
  return new Headers(call?.init.headers).get(name)
}
