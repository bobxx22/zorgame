import { describe, expect, it } from 'vitest'
import { ApiClient } from '../api/client'
import { FakeClock, json, scriptedFetch } from '../api/testing'
import { FRAME_A } from '../ether/fixtures'
import { armedRetryDelay, registerWithRecovery, type RegisterOutcome, type RegisterStep } from './register'
import type { RegisterForm } from './validate'

// Built at run time: no literal in the tree looks like a real password or token to a secret scanner.
const PASSWORD = ['test', 'only', 'pass'].join('-')
const TOKEN = 'test-session-'.padEnd(43, '0')

const FORM: RegisterForm = {
  username: 'BobX',
  displayName: 'Північна вахта',
  password: PASSWORD,
  invitation: 'ZORIA-2026-BOBX',
  repository: 'https://github.com/bobxx22/zorgame.git',
  lang: 'uk',
}

const SESSION = {
  token: TOKEN,
  sessionId: '3f0c1d2e-5b6a-4c7d-8e9f-0a1b2c3d4e5f',
  expiresAt: '2026-09-25T09:00:04.311Z',
  user: {
    id: '8d7e6f50-4a3b-4c2d-9e1f-001122334455',
    username: 'bobx',
    displayName: 'Північна вахта',
    role: 'participant',
    disabled: false,
    createdAt: '2026-09-24T09:00:04.311Z',
    lang: 'uk',
  },
}

const err = (status: number, code: string, field?: string) =>
  json(status, { error: field ? { code, field } : { code } })

function setup(replies: Parameters<typeof scriptedFetch>[1], lostBefore = false) {
  const clock = new FakeClock(0)
  const { fetch, calls } = scriptedFetch(clock, replies)
  const api = new ApiClient('https://stand.zoria.net/api/v1', { clock, fetch, random: () => 0 })
  api.limiter.setPhase('window')
  const steps: RegisterStep[] = []
  const run = () =>
    registerWithRecovery(FORM, { api, clock, random: () => 0, onStep: (s) => steps.push(s), lostBefore })
  const paths = () => calls.map((c) => `${c.init.method ?? 'GET'} ${c.url.replace('https://stand.zoria.net/api/v1', '')}`)
  const bodies = () => calls.map((c) => JSON.parse(c.init.body as string) as Record<string, unknown>)
  return { run, paths, bodies, steps }
}

describe('registerWithRecovery', () => {
  it('registers and sends the normalized login and repository', async () => {
    const { run, bodies } = setup([json(201, SESSION)])
    expect(await run()).toMatchObject({ kind: 'registered', via: 'register' })
    expect(bodies()[0]).toEqual({
      username: 'bobx',
      displayName: 'Північна вахта',
      password: PASSWORD,
      invitation: 'ZORIA-2026-BOBX',
      repositoryUrl: 'bobxx22/zorgame',
      lang: 'uk',
    })
  })

  it('after a lost answer logs in instead of registering again (CL-17)', async () => {
    const { run, paths, steps } = setup([new TypeError('reset'), json(200, SESSION)])
    expect(await run()).toMatchObject({ kind: 'registered', via: 'login' })
    expect(paths()).toEqual(['POST /auth/register', 'POST /auth/login'])
    expect(steps).toEqual(['registering', 'recovering'])
  })

  it('repeats registration only after login says there is no account', async () => {
    const { run, paths } = setup([
      json(502, { error: { code: 'internal-error' } }),
      err(401, 'invalid-credentials'),
      json(201, SESSION),
    ])
    expect(await run()).toMatchObject({ kind: 'registered', via: 'register' })
    expect(paths()).toEqual(['POST /auth/register', 'POST /auth/login', 'POST /auth/register'])
  })

  it('checks by login on username-unavailable: our own account from a lost answer', async () => {
    const { run, paths } = setup([err(409, 'username-unavailable'), json(200, SESSION)])
    expect(await run()).toMatchObject({ kind: 'registered', via: 'login' })
    expect(paths()).toEqual(['POST /auth/register', 'POST /auth/login'])
  })

  it('reports a login taken by someone else next to the field', async () => {
    const { run } = setup([err(409, 'username-unavailable'), err(401, 'invalid-credentials')])
    expect(await run()).toEqual({ kind: 'field', field: 'username', code: 'username-unavailable' })
  })

  it('maps field errors to form fields (CL-18)', async () => {
    const cases: [Response, string, string][] = [
      [err(422, 'invalid-field', 'password'), 'password', 'invalid-field'],
      [err(422, 'repository-not-eligible', 'repositoryUrl'), 'repository', 'repository-not-eligible'],
      [err(422, 'repository-not-root', 'repositoryUrl'), 'repository', 'repository-not-root'],
      [err(409, 'repository-already-verified'), 'repository', 'repository-already-verified'],
      [err(422, 'invalid-invitation', 'invitation'), 'invitation', 'invalid-invitation'],
    ]
    for (const [reply, field, code] of cases) {
      const { run } = setup([reply, err(401, 'invalid-credentials')])
      expect(await run()).toEqual({ kind: 'field', field, code })
    }
  })

  it('knows a closed window and the station talking before it', async () => {
    expect(await setup([err(403, 'registration-closed')]).run()).toEqual({ kind: 'closed' })
    expect(await setup([json(503, JSON.parse(FRAME_A))]).run()).toEqual({ kind: 'not-open' })
  })

  it('waits out authentication-busy and repeats the same request', async () => {
    const { run, paths } = setup([
      json(429, { error: { code: 'authentication-busy' } }, { 'Retry-After': '5' }),
      json(201, SESSION),
    ])
    expect(await run()).toMatchObject({ kind: 'registered', via: 'register' })
    expect(paths()).toEqual(['POST /auth/register', 'POST /auth/register'])
  })

  it('gives up with the login failure when recovery itself cannot tell', async () => {
    const lost = () => new TypeError('reset')
    const { run } = setup([lost(), lost(), lost(), lost(), lost()])
    expect(await run()).toMatchObject({ kind: 'failed', code: 'network' })
  })

  it('stops after a bounded number of lost registrations', async () => {
    const replies = []
    for (let i = 0; i < 4; i += 1) replies.push(new TypeError('reset'), err(401, 'invalid-credentials'))
    const { run, paths } = setup(replies)
    expect(await run()).toMatchObject({ kind: 'failed', code: 'lost', lost: true })
    expect(paths().filter((p) => p === 'POST /auth/register')).toHaveLength(4)
  })

  it('keeps X-Request-Id and the UTC time of a lost 5xx for the report (CL-37)', async () => {
    const replies = []
    for (let i = 0; i < 4; i += 1) {
      replies.push(json(502, { error: { code: 'internal-error', requestId: `req-${String(i)}` } }))
      replies.push(err(401, 'invalid-credentials'))
    }
    const outcome = await setup(replies).run()
    expect(outcome).toMatchObject({ kind: 'failed', code: 'lost', status: 502, requestId: 'req-3' })
    expect(outcome.kind === 'failed' && outcome.at).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/)
  })

  it('after a lost answer checks a spent code by login: the first try may have registered us', async () => {
    const { run, paths } = setup([
      new TypeError('reset'),
      err(401, 'invalid-credentials'),
      err(422, 'invalid-invitation', 'invitation'),
      err(401, 'invalid-credentials'),
      json(200, SESSION),
    ])
    expect(await run()).toMatchObject({ kind: 'registered', via: 'login' })
    expect(paths()).toEqual([
      'POST /auth/register',
      'POST /auth/login',
      'POST /auth/register',
      'POST /auth/login',
      'POST /auth/login',
    ])
  })

  it('says the code was spent by our own lost try when login never finds the account', async () => {
    const { run } = setup(
      [err(422, 'invalid-invitation'), err(401, 'invalid-credentials'), err(401, 'invalid-credentials'), err(401, 'invalid-credentials')],
      true,
    )
    expect(await run()).toEqual({ kind: 'field', field: 'invitation', code: 'invitation-spent' })
  })

  it('checks a spent code by one login even without a known loss (the loss may predate a reload)', async () => {
    const found = setup([err(422, 'invalid-invitation', 'invitation'), json(200, SESSION)])
    expect(await found.run()).toMatchObject({ kind: 'registered', via: 'login' })
    const wrong = setup([err(422, 'invalid-invitation', 'invitation'), err(401, 'invalid-credentials')])
    expect(await wrong.run()).toEqual({ kind: 'field', field: 'invitation', code: 'invalid-invitation' })
    expect(wrong.paths()).toEqual(['POST /auth/register', 'POST /auth/login'])
  })

  it('puts an error without a field next to the field its code belongs to (CL-18)', async () => {
    expect(await setup([err(422, 'invalid-invitation'), err(401, 'invalid-credentials')]).run()).toEqual({
      kind: 'field',
      field: 'invitation',
      code: 'invalid-invitation',
    })
    expect(await setup([err(422, 'repository-not-root')]).run()).toEqual({
      kind: 'field',
      field: 'repository',
      code: 'repository-not-root',
    })
  })
})

describe('armedRetryDelay', () => {
  const failure = (code: string | null, retryAfterSec: number | null = null): RegisterOutcome => ({
    kind: 'failed',
    code,
    status: null,
    requestId: null,
    retryAfterSec,
    at: '2026-09-24T09:00:00.000Z',
    lost: false,
  })

  it('stops on what repeating cannot change', () => {
    expect(armedRetryDelay({ kind: 'closed' }, 0)).toBeNull()
    expect(armedRetryDelay({ kind: 'field', field: 'username', code: 'username-unavailable' }, 0)).toBeNull()
    expect(armedRetryDelay({ kind: 'aborted' }, 0)).toBeNull()
    expect(armedRetryDelay(failure('registration-capacity'), 0)).toBeNull()
  })

  it('waits out Retry-After of a busy queue or a rate limit', () => {
    expect(armedRetryDelay(failure('authentication-busy', 5), 0, () => 0)).toBe(5_000)
    expect(armedRetryDelay(failure('rate-limited', 40), 3, () => 0.99)).toBe(40_000)
  })

  it('backs off with full jitter otherwise, never faster than a second', () => {
    expect(armedRetryDelay(failure('network'), 0, () => 0)).toBe(1_000)
    expect(armedRetryDelay(failure('lost'), 5, () => 0.5)).toBe(16_000)
    expect(armedRetryDelay({ kind: 'not-open' }, 10, () => 0.5)).toBe(30_000)
  })
})
