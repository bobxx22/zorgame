import { useEffect, useState, type SubmitEvent } from 'react'
import { useAuth, type AuthState } from '../app/auth-context'
import { useEther } from '../app/ether-context'
import { REGISTER_CODE_MESSAGE } from '../auth/register'
import { parseRepositoryEnvelope, type AccessStatus, type ReasonCode, type Repository } from '../auth/schemas'
import { checkRepository, parseRepository } from '../auth/validate'
import { SEASON } from '../config/season'
import { formatLocal, zoneLabel } from '../lib/time'
import { ACCESS_STATUS, REASON_TEXT } from './auth-labels'
import { InviteCard } from './InviteCard'
import { LoginForm } from './LoginForm'

type Load =
  | { state: 'loading' }
  | { state: 'ready'; repository: Repository | null }
  | { state: 'noise' }
  | { state: 'error'; text: string }

const NOISE_TEXT = 'Станція в шумі: до просвіту сервер відповідає перешкодами, статус заявки недоступний.'

function reasonText(repository: Repository): string | null {
  const code = repository.reasonCode as ReasonCode | null
  if (code && code !== 'organizer' && code in REASON_TEXT) return REASON_TEXT[code]
  if (repository.reason) return repository.reason
  if (repository.accessStatus === 'pending') return 'Запрошення ще не прийнято.'
  return null
}

/**
 * null on 401: the session guard takes over and the page keeps its state.
 * In the static phase the server answers with noise, so nothing is asked.
 */
async function readRepository(call: AuthState['call'], inStatic: boolean): Promise<Load | null> {
  if (inStatic) return { state: 'noise' }
  const result = await call({ path: '/me/repository', parse: parseRepositoryEnvelope })
  if (result.ok) return { state: 'ready', repository: result.data.repository }
  if (result.error.kind === 'http' && result.error.status === 401) return null
  if (result.error.kind === 'http' && result.error.envelope) return { state: 'noise' }
  const id = result.error.kind === 'http' ? result.error.requestId : null
  return { state: 'error', text: `Не вдалося прочитати статус${id ? ` (X-Request-Id: ${id})` : ''}.` }
}

export function AccessPage() {
  const { session, call } = useAuth()
  const { station } = useEther()
  const inStatic = station.phase === 'static'
  const [load, setLoad] = useState<Load>({ state: 'loading' })

  const refresh = () => {
    void readRepository(call, inStatic).then((next) => {
      if (next) setLoad(next)
    })
  }

  useEffect(() => {
    if (!session) return
    let active = true
    void readRepository(call, inStatic).then((next) => {
      if (active && next) setLoad(next)
    })
    return () => {
      active = false
    }
  }, [session, call, inStatic])

  if (!session) {
    return (
      <section className="panel narrow">
        <h1>Доступ до репозиторію</h1>
        <p className="muted">Увійдіть, щоб побачити статус заявки.</p>
        <LoginForm />
      </section>
    )
  }

  const repository = load.state === 'ready' ? load.repository : null
  const status = repository ? ACCESS_STATUS[repository.accessStatus as AccessStatus] : undefined

  return (
    <div className="grid">
      <section className="panel span-2">
        <div className="phase-head">
          <h1>Доступ до репозиторію</h1>
          <button type="button" onClick={refresh}>
            Оновити
          </button>
        </div>
        {load.state === 'loading' && <p className="muted">Читаємо статус…</p>}
        {load.state === 'error' && <p className="err-text">{load.text}</p>}
        {load.state === 'noise' && <p className="warn-text">{NOISE_TEXT}</p>}
        {load.state === 'ready' && !repository && <p className="warn-text">Заявки на репозиторій немає.</p>}
        {repository && (
          <dl className="kv">
            <dt>Репозиторій</dt>
            <dd className="mono">
              <a href={repository.url} target="_blank" rel="noopener noreferrer">
                {repository.url}
              </a>
            </dd>
            <dt>Статус</dt>
            <dd>
              <span className={`badge ${status ? `${status.tone}-text` : ''}`}>
                {status?.label ?? repository.accessStatus}
              </span>
            </dd>
            <dt>Причина</dt>
            <dd>{reasonText(repository) ?? '—'}</dd>
            <dt>Перевірено</dt>
            <dd className="mono">
              {repository.checkedAt ? formatLocal(repository.checkedAt) : 'рішення ще не було'}{' '}
              <span className="muted">{zoneLabel()}</span>
            </dd>
          </dl>
        )}
        {repository?.verifiedElsewhere && (
          <p className="err-text">
            Цей репозиторій уже підтверджено за іншим акаунтом. Ваша заявка підтвердитися не може: перевірте .zoria і
            напишіть організаторам.
          </p>
        )}
        <p className="muted small">
          Строк підтвердження: <b className="mono">{formatLocal(SEASON.accessDeadline)}</b> ({zoneLabel()}). Статус має
          бути «підтверджено».
        </p>
      </section>

      <section className="panel span-2">
        <InviteCard username={session.user.username} repositoryUrl={repository?.url ?? null} />
      </section>

      <ChangeRepository
        onChanged={(next) => {
          setLoad({ state: 'ready', repository: next })
        }}
      />
    </div>
  )
}

/** PUT /me/repository from the login session; status goes back to pending (CL-26). */
function ChangeRepository({ onChanged }: { onChanged: (repository: Repository | null) => void }) {
  const { call } = useAuth()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function change() {
    const local = checkRepository(value)
    if (local) {
      setError(local)
      return
    }
    const parsed = parseRepository(value)
    setBusy(true)
    setError(null)
    const result = await call({
      method: 'PUT',
      path: '/me/repository',
      body: { url: parsed.ok ? parsed.slug : value.trim() },
      parse: parseRepositoryEnvelope,
      retry: { transient: false, busy: true, maxAttempts: 3 },
    })
    setBusy(false)
    if (result.ok) {
      setValue('')
      onChanged(result.data.repository)
      return
    }
    const failure = result.error
    if (failure.kind === 'http' && failure.status === 401) return
    const code = failure.kind === 'http' ? failure.code : failure.kind === 'network' ? failure.reason : null
    if (code === 'session-required') setError('Зміна можлива тільки із сесії входу. Увійдіть логіном і паролем.')
    else setError((code && REGISTER_CODE_MESSAGE[code]) ?? 'Не вдалося змінити репозиторій.')
  }

  function onSubmit(event: SubmitEvent) {
    event.preventDefault()
    if (!busy) void change()
  }

  return (
    <section className="panel span-2">
      <h2>Змінити репозиторій</h2>
      <p className="muted small">Тільки на репозиторій зі списку заявок. Після зміни статус знову «очікує».</p>
      <form className="row" onSubmit={onSubmit}>
        <input
          className="grow"
          placeholder="owner/repo"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setError(null)
          }}
        />
        <button type="submit" disabled={busy || value.trim() === ''}>
          {busy ? 'Змінюємо…' : 'Змінити'}
        </button>
      </form>
      {error && <p className="err-text small">{error}</p>}
    </section>
  )
}
