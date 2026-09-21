import { describe, expect, it } from 'vitest'
import { ApiClient } from '../api/client'
import { abortReason, type Clock } from '../api/clock'
import { GATE_MARGIN_MS } from '../api/rate-limit'
import { FakeClock, json, scriptedFetch, text } from '../api/testing'
import {
  FRAME_A,
  FRAME_B,
  FRAME_D,
  signalFrame,
  testStation,
  TRAINING_FINGERPRINT,
  TRAINING_KEY_BODY,
  type TestStation,
} from './fixtures'
import { ETHER_INTERVAL_MS, EtherListener, KEY_REFETCH_MS, type KeyStore } from './listener'

const BASE = 'https://stand.zoria.net/api/v1'

function memoryStore(initial: unknown = null): KeyStore & { saved: unknown } {
  const store = {
    saved: initial,
    load: () => store.saved,
    save: (body: unknown) => {
      store.saved = body
    },
  }
  return store
}

function setup(replies: Parameters<typeof scriptedFetch>[1], options: { stored?: unknown; pinned?: string | null } = {}) {
  const clock = new FakeClock(Date.parse('2026-09-24T03:00:00.000Z'))
  const { fetch, calls } = scriptedFetch(clock, replies)
  const api = new ApiClient(BASE, { clock, fetch, random: () => 0 })
  const keyStore = memoryStore(options.stored ?? null)
  const listener = new EtherListener({
    api,
    keyStore,
    pinnedFingerprint: options.pinned === undefined ? TRAINING_FINGERPRINT : options.pinned,
    clock,
    random: () => 0,
  })
  const paths = () => calls.map((c) => c.url.slice(BASE.length))
  return { api, clock, calls, paths, keyStore, listener }
}

const keyReply = () => json(200, TRAINING_KEY_BODY)
const windowFrame = (station: TestStation) =>
  station.seal(
    signalFrame({
      at: '2026-09-24T09:00:05.000Z',
      phase: 'window',
      window: { opensAt: '2026-09-24T09:00:00.000Z', closesAt: '2026-09-24T19:00:00.000Z' },
    }),
  )

describe('EtherListener keys', () => {
  it('reads the key once, checks it and stores it', async () => {
    const { listener, keyStore, paths } = setup([keyReply()])
    await listener.prepareKey()
    await listener.prepareKey()
    expect(paths()).toEqual(['/ether/key'])
    expect(keyStore.saved).toEqual(TRAINING_KEY_BODY)
    expect(listener.getSnapshot().key).toMatchObject({ id: 'f3a436df65614f08', pinned: true, changed: false })
  })

  it('restores a stored key without the network', async () => {
    const { listener, paths } = setup([], { stored: TRAINING_KEY_BODY })
    await listener.prepareKey()
    expect(paths()).toEqual([])
    expect(listener.getSnapshot().key?.id).toBe('f3a436df65614f08')
  })

  it('refuses a key that does not match the published fingerprint', async () => {
    const { listener } = setup([keyReply()], { pinned: 'a'.repeat(64) })
    await listener.prepareKey()
    expect(listener.getSnapshot()).toMatchObject({ key: null, keyProblem: 'pinned-mismatch' })
  })

  it('marks the key unavailable while the server is stopping', async () => {
    const { listener } = setup([json(503, { error: { code: 'stopping' } })])
    await listener.prepareKey()
    expect(listener.getSnapshot().keyProblem).toBe('unavailable')
  })

  it('re-reads the key for an unknown id at most once a minute', async () => {
    const other = FRAME_A.replace('"key":"f3a436df65614f08"', '"key":"0123456789abcdef"')
    const { listener, paths, clock } = setup(
      [json(200, JSON.parse(other)), keyReply(), json(200, JSON.parse(other)), json(200, JSON.parse(other)), keyReply()],
      { stored: TRAINING_KEY_BODY },
    )
    await listener.prepareKey()
    await listener.tick()
    await listener.tick()
    expect(paths()).toEqual(['/ether', '/ether/key', '/ether'])
    clock.current += KEY_REFETCH_MS
    await listener.tick()
    expect(paths().slice(3)).toEqual(['/ether', '/ether/key'])
    expect(listener.getSnapshot().counts['unknown-key']).toBe(3)
  })
})

describe('EtherListener polling', () => {
  it('acts only on sealed frames: a forged window changes nothing (CL-02)', async () => {
    const { listener, api } = setup([json(200, JSON.parse(FRAME_B))], { stored: TRAINING_KEY_BODY })
    await listener.prepareKey()
    expect(await listener.tick()).toBe(ETHER_INTERVAL_MS)
    expect(listener.getSnapshot().station.phase).toBeNull()
    expect(listener.getSnapshot().counts.forged).toBe(1)
    expect(api.limiter.phase).toBeNull()
  })

  it('takes the phase from a sealed frame and tells the limiter', async () => {
    const station = await testStation()
    const harbinger = { opensIn: 21_600, text: { uk: 'несуча', ru: 'несущая' } }
    const { listener, api } = setup(
      [text(200, await station.seal(signalFrame({ harbinger }))), text(200, await windowFrame(station))],
      { stored: station.body, pinned: station.fingerprint },
    )
    await listener.prepareKey()
    await listener.tick()
    expect(listener.getSnapshot().station.opensAtMs).toBe(Date.parse('2026-09-24T09:00:00.000Z'))
    expect(api.limiter.phase).toBe('static')
    await listener.tick()
    expect(listener.getSnapshot().station.phase).toBe('window')
    expect(api.limiter.phase).toBe('window')
  })

  it('accepts a sealed envelope on 503 before the window without backing off', async () => {
    const { listener } = setup([json(503, JSON.parse(FRAME_A))], { stored: TRAINING_KEY_BODY })
    await listener.prepareKey()
    expect(await listener.tick()).toBe(ETHER_INTERVAL_MS)
    expect(listener.getSnapshot().station.phase).toBe('static')
  })

  it('treats noise with a real status as noise, not as an outage', async () => {
    const { listener } = setup(
      [text(418, '<html>'), json(409, { error: { code: 'username-unavailable' } }), text(200, '{"frame":')],
      { stored: TRAINING_KEY_BODY },
    )
    await listener.prepareKey()
    for (let i = 0; i < 3; i += 1) expect(await listener.tick()).toBe(ETHER_INTERVAL_MS)
    expect(listener.getSnapshot().counts).toMatchObject({ broken: 2, 'no-envelope': 1 })
    expect(listener.getSnapshot().failureStreak).toBe(0)
  })

  it('backs off on outages and resets after an answer (CL-09)', async () => {
    const { listener } = setup(
      [
        json(502, { error: { code: 'internal-error' } }),
        new TypeError('reset'),
        json(200, JSON.parse(FRAME_A)),
      ],
      { stored: TRAINING_KEY_BODY },
    )
    await listener.prepareKey()
    expect(await listener.tick()).toBeGreaterThanOrEqual(ETHER_INTERVAL_MS)
    await listener.tick()
    expect(listener.getSnapshot().failureStreak).toBe(2)
    await listener.tick()
    expect(listener.getSnapshot().failureStreak).toBe(0)
  })

  it('goes silent after jammed until Retry-After has passed (CL-07)', async () => {
    const { listener, calls, clock } = setup(
      [json(429, { error: { code: 'jammed' } }, { 'Retry-After': '120' }), json(200, JSON.parse(FRAME_A))],
      { stored: TRAINING_KEY_BODY },
    )
    await listener.prepareKey()
    const jammedAt = clock.now()
    await listener.tick()
    expect(listener.getSnapshot().log[0]).toMatchObject({ outcome: 'jammed', status: 429 })
    await listener.tick()
    expect(calls[1]?.at).toBe(jammedAt + 120_000 + GATE_MARGIN_MS)
  })

  it('polls the roll only while wanted and at most once a minute', async () => {
    const { listener, paths, clock } = setup(
      [
        json(200, JSON.parse(FRAME_A)),
        json(200, JSON.parse(FRAME_A)),
        json(200, JSON.parse(FRAME_D)),
        json(200, JSON.parse(FRAME_A)),
        json(200, JSON.parse(FRAME_A)),
        json(200, JSON.parse(FRAME_D)),
      ],
      { stored: TRAINING_KEY_BODY },
    )
    await listener.prepareKey()
    await listener.tick()
    const release = listener.wantRoll()
    await listener.tick()
    clock.current += ETHER_INTERVAL_MS
    await listener.tick()
    clock.current += 60_000
    await listener.tick()
    release()
    expect(paths()).toEqual(['/ether', '/ether', '/ether/roll', '/ether', '/ether', '/ether/roll'])
    expect(listener.getSnapshot().station.roll?.entries).toHaveLength(2)
  })
})

/** Sleep that never ends on its own: the loop runs one cycle and waits. */
class ParkedClock implements Clock {
  readonly inner = new FakeClock(Date.parse('2026-09-24T03:00:00.000Z'))
  now = () => this.inner.now()
  sleep = (_ms: number, signal?: AbortSignal) =>
    new Promise<void>((_, reject) => {
      signal?.addEventListener('abort', () => {
        reject(abortReason(signal))
      })
    })
}

describe('EtherListener start/stop', () => {
  it('runs one cycle, waits, and stops on request', async () => {
    const clock = new ParkedClock()
    const { fetch, calls } = scriptedFetch(clock, [json(200, JSON.parse(FRAME_A))])
    const api = new ApiClient(BASE, { clock, fetch, random: () => 0 })
    const listener = new EtherListener({
      api,
      keyStore: memoryStore(TRAINING_KEY_BODY),
      pinnedFingerprint: TRAINING_FINGERPRINT,
      clock,
      random: () => 0,
    })
    const seen: boolean[] = []
    const unsubscribe = listener.subscribe(() => seen.push(listener.getSnapshot().listening))
    listener.start()
    listener.start()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(calls).toHaveLength(1)
    expect(listener.getSnapshot().nextPollAtMs).toBe(clock.now() + ETHER_INTERVAL_MS)
    listener.stop()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(listener.getSnapshot()).toMatchObject({ listening: false, nextPollAtMs: null })
    expect(calls).toHaveLength(1)
    expect(seen[0]).toBe(true)
    unsubscribe()
  })
})
