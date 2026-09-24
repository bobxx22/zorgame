import { describe, expect, it } from 'vitest'
import { parseJson, parseRetryAfter, rawRequest } from './http'
import { FakeClock, headerOf, json, scriptedFetch, text } from './testing'

describe('parseJson', () => {
  it('tells JSON null from non-JSON', () => {
    expect(parseJson('null')).toEqual({ value: null })
    expect(parseJson('')).toBeNull()
    expect(parseJson('<html>')).toBeNull()
    expect(parseJson('{"frame":"{\\"v\\":1')).toBeNull()
  })
})

describe('parseRetryAfter', () => {
  const now = Date.UTC(2026, 8, 24, 9, 0, 0)
  it('reads seconds and HTTP dates', () => {
    expect(parseRetryAfter('30', now)).toBe(30)
    expect(parseRetryAfter(new Date(now + 90_000).toUTCString(), now)).toBe(90)
  })
  it('returns null for absent or unreadable values', () => {
    expect(parseRetryAfter(null, now)).toBeNull()
    expect(parseRetryAfter('soon', now)).toBeNull()
  })
})

describe('rawRequest', () => {
  const clock = new FakeClock()

  it('sends without cookies, with bearer and JSON body', async () => {
    const { fetch, calls } = scriptedFetch(clock, [json(201, { ok: true })])
    await rawRequest({ method: 'POST', url: 'https://x/api/v1/auth/logout', body: {}, token: 'T' }, fetch)
    expect(calls[0]?.init.credentials).toBe('omit')
    expect(calls[0]?.init.body).toBe('{}')
    expect(headerOf(calls[0], 'Authorization')).toBe('Bearer T')
    expect(headerOf(calls[0], 'Content-Type')).toBe('application/json')
  })

  it('sends no Content-Type and no Authorization when not needed', async () => {
    const { fetch, calls } = scriptedFetch(clock, [json(200, {})])
    await rawRequest({ method: 'GET', url: 'https://x/api/v1/ether' }, fetch)
    expect(headerOf(calls[0], 'Content-Type')).toBeNull()
    expect(headerOf(calls[0], 'Authorization')).toBeNull()
  })

  it('returns HTML, empty and odd statuses as responses', async () => {
    const { fetch } = scriptedFetch(clock, [text(418, '<html>teapot</html>'), text(204, ''), text(502, '')])
    const html = await rawRequest({ method: 'GET', url: 'u' }, fetch)
    const empty = await rawRequest({ method: 'GET', url: 'u' }, fetch)
    const gateway = await rawRequest({ method: 'GET', url: 'u' }, fetch)
    expect(html).toMatchObject({ kind: 'response', status: 418, json: null })
    expect(empty).toMatchObject({ kind: 'response', status: 204, text: '' })
    expect(gateway).toMatchObject({ kind: 'response', status: 502 })
  })

  it('reads Retry-After and X-Request-Id', async () => {
    const { fetch } = scriptedFetch(clock, [
      json(503, { error: { code: 'stopping' } }, { 'Retry-After': '30', 'X-Request-Id': 'req-1' }),
    ])
    expect(await rawRequest({ method: 'GET', url: 'u' }, fetch)).toMatchObject({
      retryAfterSec: 30,
      requestId: 'req-1',
    })
  })

  it('turns a dropped connection into a failure', async () => {
    const { fetch } = scriptedFetch(clock, [new TypeError('Failed to fetch')])
    expect(await rawRequest({ method: 'GET', url: 'u' }, fetch)).toEqual({ kind: 'failure', reason: 'network' })
  })

  it('turns a body that breaks off into a failure', async () => {
    const broken = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"frame":'))
          controller.error(new TypeError('terminated'))
        },
      }),
      { status: 200 },
    )
    const { fetch } = scriptedFetch(clock, [broken])
    expect(await rawRequest({ method: 'GET', url: 'u' }, fetch)).toEqual({ kind: 'failure', reason: 'network' })
  })

  it('times out a hanging request', async () => {
    const hang = (init: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason as Error)
        })
      })
    const { fetch } = scriptedFetch(clock, [hang])
    expect(await rawRequest({ method: 'GET', url: 'u', timeoutMs: 20 }, fetch)).toEqual({
      kind: 'failure',
      reason: 'timeout',
    })
  })

  it('treats a request cut off by the browser, not by us, as a network failure', async () => {
    const { fetch } = scriptedFetch(clock, [new DOMException('Aborted', 'AbortError')])
    expect(await rawRequest({ method: 'GET', url: 'u', signal: new AbortController().signal }, fetch)).toEqual({
      kind: 'failure',
      reason: 'network',
    })
  })

  it('reports a caller abort as aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const { fetch } = scriptedFetch(clock, [new DOMException('Aborted', 'AbortError')])
    expect(await rawRequest({ method: 'GET', url: 'u', signal: controller.signal }, fetch)).toEqual({
      kind: 'failure',
      reason: 'aborted',
    })
  })
})
