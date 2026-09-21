import { describe, expect, it } from 'vitest'
import { ApiClient, looksLikeEnvelope, type CallOptions } from './client'
import { GATE_MARGIN_MS } from './rate-limit'
import { FakeClock, json, scriptedFetch, text } from './testing'

const BASE = 'https://zoria.net/api/v1'

const ENVELOPE = {
  frame: '{"v":1,"kind":"signal","station":"zoria"}',
  seal: 'NEcYfpe3oNX3SMBFWWFgWbkhLGKIoLELoaQn62BtuElLU213zmgzXBUPtQbJMhGf4jxbPjIf9oKXIFOpuYrgCw',
  key: 'f3a436df65614f08',
}

interface Unread {
  unread: number
}

const parseUnread = (value: unknown): Unread | null =>
  typeof value === 'object' && value !== null && typeof (value as Unread).unread === 'number'
    ? { unread: (value as Unread).unread }
    : null

function setup(replies: Parameters<typeof scriptedFetch>[1]) {
  const clock = new FakeClock(0)
  const { fetch, calls } = scriptedFetch(clock, replies)
  const api = new ApiClient(`${BASE}/`, { clock, fetch, random: () => 0.5 })
  return { api, clock, calls }
}

const summary: CallOptions<Unread> = { path: '/me/summary', token: 'T', parse: parseUnread }

describe('looksLikeEnvelope', () => {
  it('checks the envelope form', () => {
    expect(looksLikeEnvelope(ENVELOPE)).toBe(true)
    expect(looksLikeEnvelope({ ...ENVELOPE, seal: 'short' })).toBe(false)
    expect(looksLikeEnvelope({ error: { code: 'stopping' } })).toBe(false)
  })
})

describe('ApiClient.call', () => {
  it('returns parsed data with the request id', async () => {
    const { api, calls } = setup([json(200, { unread: 2 }, { 'X-Request-Id': 'r1' })])
    expect(await api.call(summary)).toEqual({ ok: true, status: 200, data: { unread: 2 }, requestId: 'r1' })
    expect(calls[0]?.url).toBe(`${BASE}/me/summary`)
  })

  it('builds the query string', async () => {
    const { api, calls } = setup([json(200, { unread: 0 })])
    await api.call({ ...summary, path: '/news', query: { limit: 50, offset: 0, skip: undefined } })
    expect(calls[0]?.url).toBe(`${BASE}/news?limit=50&offset=0`)
  })

  it('reports a 2xx that is not the expected object as unexpected', async () => {
    const { api } = setup([text(200, '<html>'), text(204, ''), json(200, ['x'])])
    for (let i = 0; i < 3; i += 1) {
      const result = await api.call(summary)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.kind).toBe('unexpected')
    }
  })

  it('passes field errors through', async () => {
    const { api } = setup([json(422, { error: { code: 'invalid-field', field: 'password' } })])
    expect(await api.call({ ...summary, method: 'POST', path: '/auth/register', body: {} })).toMatchObject({
      ok: false,
      error: { kind: 'http', status: 422, code: 'invalid-field', field: 'password', envelope: false },
    })
  })

  it('retries a dropped GET with growing backoff, then succeeds', async () => {
    const { api, clock, calls } = setup([new TypeError('reset'), new TypeError('reset'), json(200, { unread: 1 })])
    const result = await api.call(summary)
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(3)
    expect(clock.sleeps).toEqual([500, 1_000])
  })

  it('never resends a POST after a lost answer', async () => {
    const { api, calls } = setup([new TypeError('reset')])
    const result = await api.call({ ...summary, method: 'POST', path: '/auth/register', body: {} })
    expect(result).toEqual({ ok: false, error: { kind: 'network', reason: 'network' } })
    expect(calls).toHaveLength(1)
  })

  it('gives up on 5xx after maxAttempts and keeps the request id', async () => {
    const replies = Array.from({ length: 3 }, () =>
      json(500, { error: { code: 'internal-error', requestId: 'r9' } }, { 'X-Request-Id': 'r9' }),
    )
    const { api, calls } = setup(replies)
    const result = await api.call({ ...summary, retry: { transient: true, busy: true, maxAttempts: 3 } })
    expect(calls).toHaveLength(3)
    expect(result).toMatchObject({ ok: false, error: { kind: 'http', status: 500, requestId: 'r9' } })
  })

  it('waits at least Retry-After on 503 stopping', async () => {
    const { api, clock } = setup([
      json(503, { error: { code: 'stopping' } }, { 'Retry-After': '30' }),
      json(200, { unread: 0 }),
    ])
    expect((await api.call(summary)).ok).toBe(true)
    expect(clock.sleeps).toEqual([30_000])
  })

  it('does not retry a 503 that carries an ether envelope', async () => {
    const { api, calls } = setup([json(503, ENVELOPE)])
    const result = await api.call(summary)
    expect(calls).toHaveLength(1)
    expect(result).toMatchObject({ ok: false, error: { kind: 'http', status: 503, envelope: true } })
  })

  it('retries authentication-busy after Retry-After, even for a POST', async () => {
    const { api, clock, calls } = setup([
      json(429, { error: { code: 'authentication-busy' } }, { 'Retry-After': '5' }),
      json(201, { unread: 0 }),
    ])
    const result = await api.call({ ...summary, method: 'POST', path: '/auth/register', body: {} })
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(2)
    expect(clock.sleeps).toEqual([5_000])
    expect(api.limiter.gateUntil).toBe(0)
  })

  it('goes silent for Retry-After after jammed: the next request waits', async () => {
    const { api, calls } = setup([
      json(429, { error: { code: 'jammed' } }, { 'Retry-After': '60' }),
      json(200, { unread: 0 }),
    ])
    expect(await api.call(summary)).toMatchObject({ ok: false, error: { status: 429, code: 'jammed' } })
    await api.call(summary)
    expect(calls[1]?.at).toBe(60_000 + GATE_MARGIN_MS)
  })

  it('holds the gate on rate-limited too', async () => {
    const { api } = setup([json(429, { error: { code: 'rate-limited' } }, { 'Retry-After': '60' })])
    await api.call(summary)
    expect(api.limiter.gateUntil).toBe(60_000 + GATE_MARGIN_MS)
  })

  it('spends the local bucket before the window, not after it with a token', async () => {
    const replies = Array.from({ length: 20 }, () => json(200, { unread: 0 }))
    const { api, clock } = setup(replies)
    for (let i = 0; i < 15; i += 1) await api.call(summary)
    expect(clock.now()).toBe(0)
    await api.call(summary)
    expect(clock.now()).toBeGreaterThan(0)

    api.limiter.setPhase('window')
    const before = clock.now()
    for (let i = 0; i < 4; i += 1) await api.call(summary)
    expect(clock.now()).toBe(before)
  })

  it('stops quietly when aborted', async () => {
    const { api, calls } = setup([])
    const controller = new AbortController()
    controller.abort()
    expect(await api.call({ ...summary, signal: controller.signal })).toEqual({
      ok: false,
      error: { kind: 'network', reason: 'aborted' },
    })
    expect(calls).toHaveLength(0)
  })
})
