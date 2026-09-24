/**
 * One HTTP exchange that never throws (CL-01): any status, empty or non-JSON
 * body, HTML, a dropped connection or a slow answer comes back as a value.
 * Browser requests go without cookies and with Authorization only (spec 2).
 */

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH'

/** Noise may answer 2-8 s late; a real answer is never dropped for being slow. */
export const DEFAULT_TIMEOUT_MS = 15_000

export interface RawRequest {
  method: Method
  url: string
  body?: unknown
  token?: string | null
  timeoutMs?: number
  signal?: AbortSignal | undefined
}

export type FailureReason = 'timeout' | 'network' | 'aborted'

export type RawResult =
  | {
      kind: 'response'
      status: number
      text: string
      /** Parsed JSON, or null when the body is not JSON. `{ value: null }` is a JSON null. */
      json: { value: unknown } | null
      retryAfterSec: number | null
      requestId: string | null
    }
  | { kind: 'failure'; reason: FailureReason }

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export function parseJson(text: string): { value: unknown } | null {
  if (text.trim() === '') return null
  try {
    return { value: JSON.parse(text) as unknown }
  } catch {
    return null
  }
}

/** Retry-After as delta-seconds or an HTTP date; null when absent or unreadable. */
export function parseRetryAfter(header: string | null, nowMs: number): number | null {
  if (header === null) return null
  const value = header.trim()
  if (/^\d+$/.test(value)) return Number(value)
  const date = Date.parse(value)
  if (Number.isNaN(date)) return null
  return Math.max(0, Math.ceil((date - nowMs) / 1000))
}

export async function rawRequest(
  request: RawRequest,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  nowMs: () => number = Date.now,
): Promise<RawResult> {
  const timeout = new AbortController()
  const timer = globalThis.setTimeout(() => {
    timeout.abort(new DOMException('Timed out', 'TimeoutError'))
  }, request.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const signal = request.signal ? anySignal([request.signal, timeout.signal]) : timeout.signal

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (request.body !== undefined) headers['Content-Type'] = 'application/json'
  if (request.token) headers.Authorization = `Bearer ${request.token}`

  try {
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers,
      body: request.body === undefined ? null : JSON.stringify(request.body),
      credentials: 'omit',
      mode: 'cors',
      cache: 'no-store',
      signal,
    })
    // The body can break off midway; that is a failure, not a response.
    const text = await response.text()
    return {
      kind: 'response',
      status: response.status,
      text,
      json: parseJson(text),
      retryAfterSec: parseRetryAfter(response.headers.get('Retry-After'), nowMs()),
      requestId: response.headers.get('X-Request-Id'),
    }
  } catch {
    if (request.signal?.aborted) return { kind: 'failure', reason: 'aborted' }
    if (timeout.signal.aborted) return { kind: 'failure', reason: 'timeout' }
    // Neither our signal nor our timeout: the browser or the network cut it off - an ordinary failure
    // that the callers retry, not a cancellation they would silently accept.
    return { kind: 'failure', reason: 'network' }
  } finally {
    globalThis.clearTimeout(timer)
  }
}

/** AbortSignal.any where it exists (Safari has it from 17.4), a small stand-in elsewhere. */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const native = (AbortSignal as { any?: (signals: AbortSignal[]) => AbortSignal }).any
  if (native) return native.call(AbortSignal, signals)
  const controller = new AbortController()
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      break
    }
    signal.addEventListener(
      'abort',
      () => {
        controller.abort(signal.reason)
      },
      { once: true },
    )
  }
  return controller.signal
}
