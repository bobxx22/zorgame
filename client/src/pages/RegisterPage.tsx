import type { SubmitEvent, ReactNode } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../app/auth-context'
import { useEther } from '../app/ether-context'
import { useRegistration, type RegistrationStatus } from '../app/registration-context'
import { REGISTER_CODE_MESSAGE } from '../auth/register'
import { parseRepository, type FormField, type Lang } from '../auth/validate'
import { serverNow } from '../ether/station'
import { formatDuration, formatLocal, zoneLabel } from '../lib/time'
import { useNow } from '../lib/use-now'
import { InviteCard } from './InviteCard'

export function RegisterPage() {
  const { session } = useAuth()
  const { status } = useRegistration()

  if (session) {
    return (
      <div className="grid">
        <section className="panel span-2">
          <h1>Ви на зв'язку</h1>
          <p>
            {status.state === 'done' ? 'Реєстрацію виконано. ' : ''}
            Акаунт <b className="mono">{session.user.username}</b>, ім'я в журналі: <b>{session.user.displayName}</b>.
          </p>
          {status.state === 'done' && status.via === 'login' && (
            <p className="muted small">
              Відповідь на реєстрацію загубилася, але акаунт створено: клієнт перевірив це входом.
            </p>
          )}
          <InviteCard username={session.user.username} repositoryUrl={null} />
          <p>
            <Link to="/access">Статус доступу до репозиторію →</Link>
          </p>
        </section>
      </div>
    )
  }

  return (
    <div className="grid">
      <WindowPanel />
      <FormPanel />
    </div>
  )
}

function WindowPanel() {
  const { station } = useEther()
  const now = useNow()
  const srvNow = serverNow(station, now)
  let body: ReactNode
  if (station.phase === 'window' && station.window) {
    body = (
      <p className="ok-text">
        Просвіт відкрито: реєстрація працює ще {formatDuration(station.window.closesAtMs - srvNow)} (до{' '}
        {formatLocal(station.window.closesAtMs)}).
      </p>
    )
  } else if (station.phase === 'after') {
    body = <p className="err-text">Просвіт завершено, реєстрацію закрито.</p>
  } else if (station.phase === 'static' && station.opensAtMs !== null) {
    body = (
      <p>
        Просвіт відкриється через <b className="mono">{formatDuration(station.opensAtMs - srvNow)}</b> (о{' '}
        {formatLocal(station.opensAtMs)}, {zoneLabel()}). Заготуйте заявку - клієнт надішле її сам.
      </p>
    )
  } else {
    body = (
      <p>
        Реєстрація відкривається тільки в просвіт. Заготуйте заявку зараз: клієнт надішле її за першим перевіреним
        кадром просвіту, якщо вкладку не закрито.
      </p>
    )
  }
  return (
    <section className="panel span-2">
      <h1>Реєстрація в мережі</h1>
      {body}
    </section>
  )
}

const STEP_TEXT = {
  registering: 'Надсилаємо заявку…',
  recovering: 'Відповідь загубилася. Перевіряємо входом, чи акаунт уже створено…',
  retrying: 'Акаунта немає. Надсилаємо заявку ще раз…',
} as const

function StatusLine({ status }: { status: RegistrationStatus }) {
  switch (status.state) {
    case 'idle':
    case 'done':
      return null
    case 'armed':
      return (
        <p className="warn-text">
          Заявку заготовлено. Її буде надіслано автоматично за першим перевіреним кадром просвіту. Не закривайте вкладку.
        </p>
      )
    case 'checking':
      return <p className="muted">Перевіряємо, чи відкрито просвіт…</p>
    case 'sending':
      return <p className="muted">{STEP_TEXT[status.step]}</p>
    case 'error': {
      const { outcome } = status
      if (outcome.kind === 'not-open') return <p className="warn-text">Просвіт ще не відкрито: реєстрація не працює.</p>
      if (outcome.kind === 'closed') return <p className="err-text">Просвіт минув, реєстрацію закрито.</p>
      if (outcome.kind === 'field') return <p className="err-text">Виправте поле з позначкою.</p>
      if (outcome.kind === 'aborted') return null
      const text = (outcome.code && REGISTER_CODE_MESSAGE[outcome.code]) ?? `Помилка ${String(outcome.status ?? '')}`
      return (
        <p className="err-text">
          {text}
          {outcome.retryAfterSec !== null && ` Повторіть через ${String(outcome.retryAfterSec)} с.`}
          {outcome.requestId && <span className="mono small"> X-Request-Id: {outcome.requestId}</span>}
        </p>
      )
    }
  }
}

function FormPanel() {
  const { draft, setDraft, errors, status, submit, arm, disarm } = useRegistration()
  const { station } = useEther()
  const busy = status.state === 'sending' || status.state === 'checking'
  const armed = status.state === 'armed'
  const repo = parseRepository(draft.repository)

  function onSubmit(event: SubmitEvent) {
    event.preventDefault()
    if (!busy) submit()
  }

  const field = (name: FormField) => (errors[name] ? <span className="field-error">{errors[name]}</span> : null)

  return (
    <section className="panel span-2">
      <form className="form" onSubmit={onSubmit}>
        <label className="field">
          <span>Логін у мережі</span>
          <input
            autoComplete="username"
            value={draft.username}
            disabled={armed}
            onChange={(e) => {
              setDraft({ username: e.target.value })
            }}
          />
          <small className="muted">3-32 знаки: латинська літера, далі літери, цифри, _ і -. Його ж пишете в .zoria.</small>
          {field('username')}
        </label>

        <label className="field">
          <span>Відображуване ім'я</span>
          <input
            value={draft.displayName}
            disabled={armed}
            onChange={(e) => {
              setDraft({ displayName: e.target.value })
            }}
          />
          <small className="warn-text">Це ім'я бачать усі в публічному журналі виходу на зв'язок.</small>
          {field('displayName')}
        </label>

        <label className="field">
          <span>Пароль</span>
          <input
            type="password"
            autoComplete="new-password"
            value={draft.password}
            disabled={armed}
            onChange={(e) => {
              setDraft({ password: e.target.value })
            }}
          />
          <small className="muted">
            12-256 знаків. Зміни пароля і відновлення в мережі немає: збережіть його в менеджері паролів.
          </small>
          {field('password')}
        </label>

        <label className="field">
          <span>Репозиторій</span>
          <input
            placeholder="owner/repo або https://github.com/owner/repo"
            value={draft.repository}
            disabled={armed}
            onChange={(e) => {
              setDraft({ repository: e.target.value })
            }}
          />
          {repo.ok && <small className="muted mono">{repo.url}</small>}
          {field('repository')}
        </label>

        <label className="field">
          <span>Мова листів сервера</span>
          <select
            value={draft.lang}
            disabled={armed}
            onChange={(e) => {
              setDraft({ lang: e.target.value as Lang })
            }}
          >
            <option value="uk">українська</option>
            <option value="en">English</option>
          </select>
        </label>

        <StatusLine status={status} />

        <div className="row">
          <button type="submit" className="primary" disabled={busy || armed}>
            {station.phase === 'window' ? 'Зареєструватися' : 'Надіслати зараз'}
          </button>
          {armed ? (
            <button type="button" onClick={disarm}>
              Скасувати заготовку
            </button>
          ) : (
            station.phase !== 'window' && (
              <button type="button" disabled={busy} onClick={arm}>
                Заготувати й надіслати в просвіт
              </button>
            )
          )}
        </div>
        {armed && (
          <p className="muted small">
            Пароль заготовки зберігається тільки в цій вкладці браузера і зникає, коли її закрито.
          </p>
        )}
      </form>
    </section>
  )
}
