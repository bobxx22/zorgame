import { Backoff, fullJitter } from '../api/backoff'
import type { ApiClient, ApiFailure, RetryPolicy } from '../api/client'
import type { Clock } from '../api/clock'
import { parseIssuedSession, type Applicant, type Session } from './schemas'
import { normalizeUsername, parseRepository, type FormField, type RegisterForm } from './validate'

/**
 * Registration with recovery (CL-17): a lost answer (timeout, dropped
 * connection, 5xx) is never resent blindly. First log in with the same login
 * and password: 200 means the account exists, 401 invalid-credentials means
 * it does not and registration may be repeated. 409 username-unavailable also
 * goes through login first: it may be our own account from a lost answer.
 * Once an answer was lost, any 409/422 is checked by login too: the one-time
 * code may have been spent by our own first try. authentication-busy is
 * waited out by the API client (Retry-After, then the same request).
 */

export type RegisterStep = 'registering' | 'recovering' | 'retrying'

export type RegisterOutcome =
  | { kind: 'registered'; session: Session; via: 'register' | 'login' }
  | { kind: 'field'; field: FormField; code: string }
  | { kind: 'closed' }
  | { kind: 'not-open' }
  | {
      kind: 'failed'
      code: string | null
      status: number | null
      requestId: string | null
      retryAfterSec: number | null
      /** UTC time of the failure: with X-Request-Id it is what the organizers ask for (spec 6, CL-37). */
      at: string
      /** An answer got lost in this series: the account may exist even if the next try says otherwise. */
      lost: boolean
    }
  | { kind: 'aborted' }

/** Register: only authentication-busy is repeated; anything lost goes to recovery. */
const REGISTER_RETRY: RetryPolicy = { transient: false, busy: true, maxAttempts: 8 }
/** Login changes nothing but the session list, so a lost login may be repeated. */
const LOGIN_RETRY: RetryPolicy = { transient: true, busy: true, maxAttempts: 4 }
/** How many times registration is attempted after recovery said "no account". */
export const MAX_REGISTER_ATTEMPTS = 4
const REGISTER_TIMEOUT_MS = 20_000
/**
 * After a lost answer the account may show up minutes later: the password
 * queue is busiest right when the window opens. Login is asked along this
 * schedule (about three minutes) before "no account" is believed.
 */
export const LOGIN_CHECK_PAUSES_MS: readonly number[] = [5_000, 10_000, 15_000, 30_000, 30_000, 30_000, 30_000, 30_000]
export const LOGIN_CHECKS_AFTER_LOSS = LOGIN_CHECK_PAUSES_MS.length + 1

const FIELD_OF: Record<string, FormField> = {
  username: 'username',
  displayName: 'displayName',
  'password': 'password',
  repositoryUrl: 'repository',
  invitation: 'invitation',
  lang: 'lang',
}

/** Where an error belongs when the server names no field (CL-18). */
const FIELD_OF_CODE: Record<string, FormField> = {
  'invalid-invitation': 'invitation',
  'invitation-spent': 'invitation',
  'username-unavailable': 'username',
  'invalid-repository': 'repository',
  'repository-not-root': 'repository',
  'repository-not-eligible': 'repository',
  'repository-already-verified': 'repository',
}

function isLost(error: ApiFailure): boolean {
  if (error.kind === 'network') return error.reason !== 'aborted'
  if (error.kind === 'http') return error.status >= 500 && !error.envelope
  return false
}

interface Trace {
  lost: boolean
  /** The last lost answer that carried an id (a 5xx), for the report to the organizers. */
  requestId: string | null
  status: number | null
  at: string | null
}

function failed(error: ApiFailure, trace: Trace, clock: Clock): RegisterOutcome {
  const at = new Date(clock.now()).toISOString()
  const lost = trace.lost
  if (error.kind === 'network') {
    if (error.reason === 'aborted') return { kind: 'aborted' }
    return { kind: 'failed', code: error.reason, status: trace.status, requestId: trace.requestId, retryAfterSec: null, at, lost }
  }
  if (error.kind === 'unexpected') {
    return { kind: 'failed', code: 'unexpected', status: error.status, requestId: error.requestId, retryAfterSec: null, at, lost }
  }
  return {
    kind: 'failed',
    code: error.code,
    status: error.status,
    requestId: error.requestId ?? trace.requestId,
    retryAfterSec: error.retryAfterSec,
    at,
    lost,
  }
}

export interface RegisterDeps {
  api: ApiClient
  clock: Clock
  random?: () => number
  onStep?: (step: RegisterStep) => void
  signal?: AbortSignal
  /** An earlier try of the same application lost its answer (the armed loop carries this over). */
  lostBefore?: boolean
  /** Verifies an ether envelope that came instead of an answer; without it any envelope is believed. */
  hear?: (text: string) => Promise<boolean>
}

type LoginCheck = { kind: 'exists'; session: Session } | { kind: 'absent' } | { kind: 'unknown'; error: ApiFailure }

async function checkByLogin(
  deps: RegisterDeps,
  applicant: Applicant,
  password: string,
  tries: number,
): Promise<LoginCheck> {
  for (let i = 1; ; i += 1) {
    const result = await deps.api.call({
      method: 'POST',
      path: '/auth/login',
      body: { username: applicant.username, password },
      parse: parseIssuedSession(applicant, () => deps.clock.now()),
      retry: LOGIN_RETRY,
      ...(deps.signal ? { signal: deps.signal } : {}),
    })
    if (result.ok) return { kind: 'exists', session: result.data }
    const { error } = result
    if (!(error.kind === 'http' && error.status === 401)) return { kind: 'unknown', error }
    if (i >= tries) return { kind: 'absent' }
    await deps.clock.sleep(LOGIN_CHECK_PAUSES_MS[i - 1] ?? 30_000, deps.signal)
  }
}

export async function registerWithRecovery(form: RegisterForm, deps: RegisterDeps): Promise<RegisterOutcome> {
  const username = normalizeUsername(form.username)
  const repository = parseRepository(form.repository)
  const body = {
    username,
    displayName: form.displayName,
    password: form.password,
    invitation: form.invitation.trim(),
    repositoryUrl: repository.ok ? repository.slug : form.repository.trim(),
    lang: form.lang,
  }
  const applicant: Applicant = { username, displayName: form.displayName, lang: form.lang }
  const backoff = new Backoff(deps.random)
  const trace: Trace = { lost: deps.lostBefore ?? false, requestId: null, status: null, at: null }
  let repeated = false

  try {
    for (let attempt = 1; attempt <= MAX_REGISTER_ATTEMPTS; attempt += 1) {
      deps.onStep?.(repeated ? 'retrying' : 'registering')
      const result = await deps.api.call({
        method: 'POST',
        path: '/auth/register',
        body,
        parse: parseIssuedSession(applicant, () => deps.clock.now()),
        retry: REGISTER_RETRY,
        timeoutMs: REGISTER_TIMEOUT_MS,
        ...(deps.signal ? { signal: deps.signal } : {}),
      })
      if (result.ok) return { kind: 'registered', session: result.data, via: 'register' }

      const { error } = result
      const lost = isLost(error)
      if (lost) {
        trace.lost = true
        trace.at = new Date(deps.clock.now()).toISOString()
        if (error.kind === 'http') {
          trace.requestId = error.requestId ?? trace.requestId
          trace.status = error.status
        }
      }
      const taken = error.kind === 'http' && error.status === 409 && error.code === 'username-unavailable'
      // The one-time code or the login may already be spent by our own earlier try whose answer got
      // lost - in this series, or before a reload. A spent code is always checked by login first:
      // one extra request is cheap next to losing the account over a false "code used".
      const doubtful =
        !lost &&
        error.kind === 'http' &&
        !error.envelope &&
        ((trace.lost && (error.status === 409 || error.status === 422)) || error.code === 'invalid-invitation')

      if (lost || taken || doubtful) {
        deps.onStep?.('recovering')
        const check = await checkByLogin(deps, applicant, form.password, doubtful && trace.lost ? LOGIN_CHECKS_AFTER_LOSS : 1)
        if (check.kind === 'exists') return { kind: 'registered', session: check.session, via: 'login' }
        if (check.kind === 'unknown') return failed(check.error, trace, deps.clock)
        if (lost) {
          repeated = true
          await deps.clock.sleep(backoff.next(), deps.signal)
          continue
        }
      }

      if (error.kind === 'http') {
        // The station talking instead of the API means "not open yet" - but only under its seal (CL-02).
        if (error.envelope) return !deps.hear || (await deps.hear(error.text)) ? { kind: 'not-open' } : failed(error, trace, deps.clock)
        if (error.status === 403 && error.code === 'registration-closed') return { kind: 'closed' }
        if (error.status === 422 || error.status === 409 || error.status === 400) {
          const code = trace.lost && error.code === 'invalid-invitation' ? 'invitation-spent' : error.code
          const field = (error.field ? FIELD_OF[error.field] : undefined) ?? (code ? FIELD_OF_CODE[code] : undefined)
          if (field && code) return { kind: 'field', field, code }
        }
      }
      return failed(error, trace, deps.clock)
    }
  } catch {
    // Only the pauses throw, and only on abort.
    return { kind: 'aborted' }
  }

  return {
    kind: 'failed',
    code: 'lost',
    status: trace.status,
    requestId: trace.requestId,
    retryAfterSec: null,
    at: trace.at ?? new Date(deps.clock.now()).toISOString(),
    lost: true,
  }
}

/** Answers that will not change by asking again: the armed loop stops and shows them. */
const ARMED_FINAL_CODES = new Set(['registration-capacity', 'same-origin-required', 'invalid-host', 'invalid-field'])
const ARMED_MIN_PAUSE_MS = 1_000
/** After "code spent by our own try": one more round every 30 s for about ten minutes. */
const SPENT_CODE_PAUSE_MS = 30_000
const SPENT_CODE_CHECKS = 20

/**
 * After a failed armed try: the pause before the next one, or null when asking
 * again cannot help. Retry-After is honoured, the rest backs off with full jitter.
 */
export function armedRetryDelay(outcome: RegisterOutcome, streak: number, random: () => number = Math.random): number | null {
  if (outcome.kind === 'not-open') return Math.max(ARMED_MIN_PAUSE_MS, fullJitter(streak, random))
  // The code went to our own lost try: the account is most likely there and just slow to show.
  // Keep checking by login for a while instead of dropping the application.
  if (outcome.kind === 'field' && outcome.code === 'invitation-spent') {
    return streak < SPENT_CODE_CHECKS ? SPENT_CODE_PAUSE_MS : null
  }
  if (outcome.kind !== 'failed') return null
  if (outcome.code && ARMED_FINAL_CODES.has(outcome.code)) return null
  const told = outcome.retryAfterSec !== null ? outcome.retryAfterSec * 1000 : 0
  return Math.max(ARMED_MIN_PAUSE_MS, told, fullJitter(streak, random))
}

export const REGISTER_CODE_MESSAGE: Record<string, string> = {
  'invalid-invitation': 'Код заявки чужий, уже використаний або прострочений. Перевірте код із листа організаторів.',
  'invitation-spent':
    'Код уже витрачено, найімовірніше вашою ж першою спробою, відповідь на яку загубилася. Акаунт міг ще не з’явитися: за хвилину увійдіть тим самим логіном і паролем.',
  'username-unavailable': 'Цей логін зайнятий. Оберіть інший.',
  'repository-already-verified': 'Цей репозиторій уже підтверджено за іншим акаунтом. Перевірте репозиторій і напишіть організаторам.',
  'repository-not-eligible': 'Сервер не прийняв цей репозиторій. Зверніться до організаторів.',
  'same-origin-required': 'Запит пішов із cookie з чужого origin. Клієнт має надсилати credentials: omit і токен у заголовку.',
  'invalid-host': 'Сервер не знає цього імені. Звірте адресу API в налаштуваннях.',
  'repository-not-root': 'Це посилання всередину репозиторію. Вкажіть адресу самого репозиторію.',
  'invalid-repository': 'Це не адреса репозиторію GitHub.',
  'invalid-field': 'Поле не пройшло перевірку сервера.',
  'registration-capacity': 'Сервер досяг межі акаунтів. Напишіть організаторам.',
  'rate-limited': 'Забагато спроб. Зачекайте хвилину.',
  'authentication-busy': 'Черга перевірки паролів зайнята.',
  timeout: 'Сервер не відповів вчасно.',
  network: 'Немає зв’язку з сервером.',
  unexpected: 'Сервер відповів незрозуміло.',
  lost: 'Відповідь губилася кілька разів поспіль.',
}
