import { useState, type SubmitEvent } from 'react'
import { useAuth } from '../app/auth-context'
import { useCabinetStore } from '../app/cabinet-context'
import { REGISTER_CODE_MESSAGE } from '../auth/register'
import { parseMe, parseRepositoryEnvelope, type ReasonCode, type Repository } from '../auth/schemas'
import { checkRepository, parseRepository, type Lang } from '../auth/validate'
import { parseDeveloperCheck, type DeveloperCheck } from '../cabinet/schemas'
import { describeFailure } from '../cabinet/store'
import { SEASON } from '../config/season'
import { formatLocal, zoneLabel } from '../lib/time'
import { accessStatusOf, REASON_TEXT } from './auth-labels'
import { CabinetScreen } from './CabinetState'
import { InviteCard } from './InviteCard'

function reasonText(repository: Repository): string | null {
  const code = repository.reasonCode as ReasonCode | null
  if (code && code !== 'organizer' && code in REASON_TEXT) return REASON_TEXT[code]
  if (repository.reason) return repository.reason
  if (repository.accessStatus === 'pending') return 'Запрошення ще не прийнято.'
  return null
}

/** Repository, access status and what to do; reread when the summary's repositoryAt moves (CL-24, CL-25). */
export function AccessPage() {
  const { session } = useAuth()
  const store = useCabinetStore()

  return (
    <CabinetScreen title="Доступ до репозиторію">
      {(cabinet) => {
        const repository = cabinet.repository
        const status = repository ? accessStatusOf(repository.accessStatus) : undefined
        return (
          <div className="grid">
            <section className="panel span-2">
              <div className="screen-head">
                <h2>Заявка</h2>
                <button
                  type="button"
                  disabled={cabinet.noise}
                  onClick={() => {
                    void store?.refreshRepository()
                  }}
                >
                  Оновити
                </button>
              </div>
              {repository === undefined && !cabinet.noise && <p className="muted">Читаємо статус…</p>}
              {repository === null && <p className="warn-text">Заявки на репозиторій немає.</p>}
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
                  Цей репозиторій уже підтверджено за іншим акаунтом. Ваша заявка підтвердитися не може: перевірте
                  .zoria і напишіть організаторам.
                </p>
              )}
              <p className="muted small">
                Строк підтвердження: <b className="mono">{formatLocal(SEASON.accessDeadline)}</b> ({zoneLabel()}).
                Статус має бути «підтверджено».
              </p>
            </section>

            {session && (
              <section className="panel span-2">
                <InviteCard username={session.user.username} repositoryUrl={repository?.url ?? null} />
              </section>
            )}

            <ChangeRepository
              onChanged={(next) => {
                store?.setRepository(next)
              }}
            />
            <Settings />
          </div>
        )
      }}
    </CabinetScreen>
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
      <p className="muted small">
        Будь-який ваш приватний репозиторій на GitHub. Після зміни статус знову «очікує»: запрошення й .zoria потрібні
        заново.
      </p>
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

/** Language of server texts (CL-42) and an exchange check (POST /developer/check). */
function Settings() {
  const { session, call, setSession } = useAuth()
  const [langNote, setLangNote] = useState<string | null>(null)
  const [check, setCheck] = useState<DeveloperCheck | string | null>(null)

  if (!session) return null
  const current = session

  async function changeLang(lang: Lang) {
    setLangNote(null)
    const result = await call({ method: 'PATCH', path: '/me', body: { lang }, parse: parseMe })
    if (result.ok) {
      setSession({ ...current, user: result.data })
      setLangNote('Збережено. Новою мовою прийдуть сповіщення і причини рішень щодо репозиторію.')
    } else {
      setLangNote(describeFailure(result) ?? 'Не вдалося змінити мову.')
    }
  }

  async function runCheck() {
    const echo = 'Зоря ✓ перевірка обміну'
    const result = await call({ method: 'POST', path: '/developer/check', body: { echo }, parse: parseDeveloperCheck })
    if (!result.ok) {
      setCheck(describeFailure(result) ?? 'Перевірка не вдалася.')
      return
    }
    setCheck(result.data.echo === echo ? result.data : 'Сервер повернув echo зі змінами.')
  }

  return (
    <section className="panel span-2">
      <h2>Налаштування</h2>
      <label className="row">
        <span className="muted">Мова листів сервера</span>
        <select
          value={current.user.lang}
          onChange={(e) => {
            void changeLang(e.target.value as Lang)
          }}
        >
          <option value="uk">українська</option>
          <option value="en">English</option>
        </select>
      </label>
      {langNote && <p className="muted small">{langNote}</p>}
      <div className="row">
        <button
          type="button"
          onClick={() => {
            void runCheck()
          }}
        >
          Перевірити обмін
        </button>
        {check !== null &&
          (typeof check === 'string' ? (
            <span className="err-text small">{check}</span>
          ) : (
            <span className="ok-text small mono">
              echo без змін · {Object.entries(check.checks).map(([k, v]) => `${k}: ${v ? 'так' : 'ні'}`).join(', ')}
            </span>
          ))}
      </div>
    </section>
  )
}
