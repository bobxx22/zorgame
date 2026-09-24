import { describe, expect, it } from 'vitest'
import { countsTowardEtherLimit, EtherLimiter, GATE_MARGIN_MS, TokenBucket } from './rate-limit'
import { FakeClock } from './testing'

describe('TokenBucket', () => {
  it('spends capacity, then asks to wait for the refill', () => {
    const bucket = new TokenBucket({ capacity: 2, refillMs: 3_000 }, 0)
    expect(bucket.take(0)).toBe(0)
    expect(bucket.take(0)).toBe(0)
    expect(bucket.take(0)).toBe(3_000)
    expect(bucket.take(1_000)).toBe(2_000)
    expect(bucket.take(3_000)).toBe(0)
  })
  it('never refills above capacity', () => {
    const bucket = new TokenBucket({ capacity: 3, refillMs: 1_000 }, 0)
    expect(bucket.available(1_000_000)).toBe(3)
  })
})

describe('countsTowardEtherLimit', () => {
  it('counts everything before the window except the exempt routes', () => {
    expect(countsTowardEtherLimit('GET', '/ether', false, 'static')).toBe(true)
    expect(countsTowardEtherLimit('GET', '/me/summary', true, 'static')).toBe(true)
    expect(countsTowardEtherLimit('POST', '/auth/register', false, 'static')).toBe(true)
    expect(countsTowardEtherLimit('POST', '/auth/login', false, 'static')).toBe(false)
    expect(countsTowardEtherLimit('GET', '/ether/key', false, 'static')).toBe(false)
    expect(countsTowardEtherLimit('GET', '/openapi.json', false, 'static')).toBe(false)
    expect(countsTowardEtherLimit('OPTIONS', '/me', false, 'static')).toBe(false)
  })
  it('counts only requests without Authorization in the window and after', () => {
    expect(countsTowardEtherLimit('GET', '/me/summary', true, 'window')).toBe(false)
    expect(countsTowardEtherLimit('GET', '/ether', false, 'window')).toBe(true)
    expect(countsTowardEtherLimit('GET', '/public/config', false, 'after')).toBe(true)
    expect(countsTowardEtherLimit('GET', '/news?limit=50&offset=0', true, 'after')).toBe(false)
  })
  it('treats an unknown phase as static', () => {
    expect(countsTowardEtherLimit('GET', '/me/summary', true, null)).toBe(true)
  })
})

describe('EtherLimiter', () => {
  it('lets the capacity through, then spaces requests by the refill', async () => {
    const clock = new FakeClock(0)
    const limiter = new EtherLimiter(clock, { capacity: 3, refillMs: 3_000 })
    for (let i = 0; i < 3; i += 1) await limiter.acquire(true)
    expect(clock.now()).toBe(0)
    await limiter.acquire(true)
    expect(clock.now()).toBe(3_000)
  })
  it('does not spend tokens on exempt requests', async () => {
    const clock = new FakeClock(0)
    const limiter = new EtherLimiter(clock, { capacity: 1, refillMs: 3_000 })
    await limiter.acquire(true)
    await limiter.acquire(false)
    await limiter.acquire(false)
    expect(clock.now()).toBe(0)
  })
  it('holds every request, exempt ones too, for Retry-After plus a margin', async () => {
    const clock = new FakeClock(0)
    const limiter = new EtherLimiter(clock)
    limiter.hold(30)
    expect(limiter.gateUntil).toBe(30_000 + GATE_MARGIN_MS)
    await limiter.acquire(false)
    expect(clock.now()).toBe(30_000 + GATE_MARGIN_MS)
    expect(limiter.gateUntil).toBe(0)
  })
  it('never shortens an existing hold', () => {
    const clock = new FakeClock(0)
    const limiter = new EtherLimiter(clock)
    limiter.hold(120)
    limiter.hold(30)
    expect(limiter.gateUntil).toBe(120_000 + GATE_MARGIN_MS)
  })
  it('rejects a wait when aborted', async () => {
    const clock = new FakeClock(0)
    const limiter = new EtherLimiter(clock)
    limiter.hold(30)
    const controller = new AbortController()
    controller.abort()
    await expect(limiter.acquire(true, controller.signal)).rejects.toBeDefined()
  })
})

describe('EtherLimiter shared gate', () => {
  function memoryGate() {
    let until = 0
    return {
      load: () => until,
      save: (value: number) => {
        until = value
      },
    }
  }

  it('starts closed when an earlier page or another tab was jammed (CL-07)', () => {
    const shared = memoryGate()
    const first = new EtherLimiter(new FakeClock(0), undefined, shared)
    first.hold(30)
    const second = new EtherLimiter(new FakeClock(5_000), undefined, shared)
    expect(second.gateUntil).toBe(31_000)
  })

  it('picks up a hold set elsewhere while it lives', () => {
    const shared = memoryGate()
    const limiter = new EtherLimiter(new FakeClock(0), undefined, shared)
    expect(limiter.gateUntil).toBe(0)
    shared.save(60_000)
    expect(limiter.gateUntil).toBe(60_000)
  })
})

describe('EtherLimiter bounds', () => {
  it('never holds longer than the longest jam, whatever storage says', () => {
    const clock = new FakeClock(0)
    const shared = { load: () => 10 * 24 * 3_600_000, save: () => undefined }
    const limiter = new EtherLimiter(clock, undefined, shared)
    expect(limiter.gateUntil).toBe(1_800_000 + GATE_MARGIN_MS)
  })
})
