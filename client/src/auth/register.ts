import { Backoff } from '../api/backoff'
import type { ApiClient, ApiFailure, RetryPolicy } from '../api/client'
import type { Clock } from '../api/clock'
import { parseSession, type Session } from './schemas'
import { normalizeUsername, parseRepository, type FormField, type RegisterForm } from './validate'

/**
 * Registration with recovery (CL-17): a lost answer (timeout, dropped
 * connection, 5xx) is never resent blindly. First log in with the same login
 * and password: 200 means the account exists, 401 invalid-credentials means
 * it does not and registration may be repeated. 409 username-unavailable also
 * goes through login first: it may be our own account from a lost answer.
 * authentication-busy is waited out by the API client (Retry-After, then the
 * same request).
 */

export type RegisterStep = 'registering' | 'recovering' | 'retrying'

export type RegisterOutcome =
  | { kind: 'registered'; session: Session; via: 'register' | 'login' }
  | { kind: 'field'; field: FormField; code: string }
  | { kind: 'closed' }
  | { kind: 'not-open' }
  | { kind: 'failed'; code: string | null; status: number | null; requestId: string | null; retryAfterSec: number | null }
  | { kind: 'aborted' }

/** Register: only authentication-busy is repeated; anything lost goes to recovery. */
const REGISTER_RETRY: RetryPolicy = { transient: false, busy: true, maxAttempts: 8 }
/** Login changes nothing but the session list, so a lost login may be repeated. */
const LOGIN_RETRY: RetryPolicy = { transient: true, busy: true, maxAttempts: 4 }
/** How many times registration is attempted after recovery said "no account". */
export const MAX_REGISTER_ATTEMPTS = 4
const REGISTER_TIMEOUT_MS = 20_000

const FIELD_OF: Record<string, FormField> = {
  username: 'username',
  displayName: 'displayName',
  'password': 'password',
  repositoryUrl: 'repository',
  lang: 'lang',
}

function isLost(error: ApiFailure): boolean {
  if (error.kind === 'network') return error.reason !== 'aborted'
  if (error.kind === 'http') return error.status >= 500 && !error.envelope
  return false
}

function failed(error: ApiFailure): RegisterOutcome {
  if (error.kind === 'network') {
    return error.reason === 'aborted'
      ? { kind: 'aborted' }
      : { kind: 'failed', code: error.reason, status: null, requestId: null, retryAfterSec: null }
  }
  if (error.kind === 'unexpected') {
    return { kind: 'failed', code: 'unexpected', status: error.status, requestId: error.requestId, retryAfterSec: null }
  }
  return { kind: 'failed', code: error.code, status: error.status, requestId: error.requestId, retryAfterSec: error.retryAfterSec }
}

export interface RegisterDeps {
  api: ApiClient
  clock: Clock
  random?: () => number
  onStep?: (step: RegisterStep) => void
  signal?: AbortSignal
}

type LoginCheck = { kind: 'exists'; session: Session } | { kind: 'absent' } | { kind: 'unknown'; error: ApiFailure }

async function checkByLogin(deps: RegisterDeps, username: string, password: string): Promise<LoginCheck> {
  const result = await deps.api.call({
    method: 'POST',
    path: '/auth/login',
    body: { username, password },
    parse: parseSession,
    retry: LOGIN_RETRY,
    ...(deps.signal ? { signal: deps.signal } : {}),
  })
  if (result.ok) return { kind: 'exists', session: result.data }
  const { error } = result
  if (error.kind === 'http' && error.status === 401) return { kind: 'absent' }
  return { kind: 'unknown', error }
}

export async function registerWithRecovery(form: RegisterForm, deps: RegisterDeps): Promise<RegisterOutcome> {
  const username = normalizeUsername(form.username)
  const repository = parseRepository(form.repository)
  const body = {
    username,
    displayName: form.displayName,
    password: form.password,
    repositoryUrl: repository.ok ? repository.slug : form.repository.trim(),
    lang: form.lang,
  }
  const backoff = new Backoff(deps.random)
  let repeated = false

  for (let attempt = 1; attempt <= MAX_REGISTER_ATTEMPTS; attempt += 1) {
    deps.onStep?.(repeated ? 'retrying' : 'registering')
    const result = await deps.api.call({
      method: 'POST',
      path: '/auth/register',
      body,
      parse: parseSession,
      retry: REGISTER_RETRY,
      timeoutMs: REGISTER_TIMEOUT_MS,
      ...(deps.signal ? { signal: deps.signal } : {}),
    })
    if (result.ok) return { kind: 'registered', session: result.data, via: 'register' }

    const { error } = result
    const taken = error.kind === 'http' && error.status === 409 && error.code === 'username-unavailable'

    // A taken login may be our own account from an earlier lost answer: log in first.
    if (isLost(error) || taken) {
      deps.onStep?.('recovering')
      const check = await checkByLogin(deps, username, form.password)
      if (check.kind === 'exists') return { kind: 'registered', session: check.session, via: 'login' }
      if (check.kind === 'unknown') return failed(check.error)
      if (taken) return { kind: 'field', field: 'username', code: 'username-unavailable' }
      repeated = true
      try {
        await deps.clock.sleep(backoff.next(), deps.signal)
      } catch {
        return { kind: 'aborted' }
      }
      continue
    }

    if (error.kind === 'http') {
      if (error.envelope) return { kind: 'not-open' }
      if (error.status === 403 && error.code === 'registration-closed') return { kind: 'closed' }
      if (error.code === 'repository-already-verified') return { kind: 'field', field: 'repository', code: error.code }
      if (error.status === 422 || error.status === 400) {
        const field = error.field ? FIELD_OF[error.field] : undefined
        if (field && error.code) return { kind: 'field', field, code: error.code }
      }
    }
    return failed(error)
  }

  return { kind: 'failed', code: 'lost', status: null, requestId: null, retryAfterSec: null }
}

export const REGISTER_CODE_MESSAGE: Record<string, string> = {
  'username-unavailable': 'Цей логін зайнятий. Оберіть інший.',
  'repository-already-verified': 'Цей репозиторій уже підтверджено за іншим акаунтом. Перевірте репозиторій і напишіть організаторам.',
  'repository-not-eligible': 'Цього репозиторію немає в списку заявок. Якщо в заявці помилка - напишіть організаторам.',
  'repository-not-root': 'Це посилання всередину репозиторію. Вкажіть адресу самого репозиторію.',
  'invalid-repository': 'Це не адреса репозиторію GitHub.',
  'invalid-field': 'Поле не пройшло перевірку сервера.',
  'registration-capacity': 'Сервер досяг межі акаунтів. Напишіть організаторам.',
  'rate-limited': 'Забагато спроб. Зачекайте хвилину.',
  timeout: 'Сервер не відповів вчасно.',
  network: 'Немає зв’язку з сервером.',
  unexpected: 'Сервер відповів незрозуміло.',
  lost: 'Відповідь губилася кілька разів поспіль. Спробуйте ще раз трохи згодом.',
}
