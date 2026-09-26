import { useState, type ReactNode, type SubmitEvent } from 'react'
import { useEther } from '../app/ether-context'
import { useRegistration, type RegistrationStatus } from '../app/registration-context'
import { rememberPassword } from '../app/credentials'
import { askNotifications } from '../app/notifications'
import { useServer } from '../app/server-context'
import { REGISTER_CODE_MESSAGE, type RegisterOutcome } from '../auth/register'
import { normalizeUsername, parseRepository, type FormField, type Lang } from '../auth/validate'
import { envInvitation } from '../config/invitation'
import { serverNow } from '../ether/station'
import { formatDayTime, formatDuration, formatLocalTime, formatUtc, zoneLabel } from '../lib/time'
import { useNow } from '../lib/use-now'
import { useRadioState } from '../sound/radio-context'
import { Icon } from '../ui/Icon'
import { Seg } from '../ui/Seg'
import { LANG_OPTIONS } from './auth-labels'

/** Where the window is, in one line above the form. */
function WindowNote() {
  const { station } = useEther()
  const now = useNow()
  const srvNow = serverNow(station, now)
  let tone = 'callout'
  let body: ReactNode
  if (station.phase === 'window' && station.window) {
    tone = 'callout ok'
    body = (
      <>
        <b>Просвіт відкрито.</b> Реєстрація працює ще{' '}
        <span className="num">{formatDuration(station.window.closesAtMs - srvNow)}</span>, до{' '}
        <span className="num">{formatDayTime(station.window.closesAtMs)}</span>.
      </>
    )
  } else if (station.phase === 'after') {
    tone = 'callout err'
    body = (
      <>
        <b>Просвіт минув.</b> Реєстрацію закрито.
      </>
    )
  } else if (station.phase === 'static' && station.opensAtMs !== null) {
    body = (
      <>
        <b>Провісник.</b> Просвіт відкриється через{' '}
        <span className="num">{formatDuration(station.opensAtMs - srvNow)}</span>, о{' '}
        <span className="num">{formatDayTime(station.opensAtMs)}</span> ({zoneLabel()}). Заготуйте заявку - клієнт
        надішле її сам.
      </>
    )
  } else {
    body = (
      <>
        <b>Просвіт ще не відкрито.</b> Заготуйте заявку зараз: клієнт надішле її за першим перевіреним кадром просвіту,
        якщо вкладку не закрито.
      </>
    )
  }
  return <p className={tone}>{body}</p>
}

const STEP_TEXT = {
  registering: 'Надсилаємо заявку…',
  recovering: 'Відповідь загубилася. Перевіряємо входом, чи акаунт уже створено…',
  retrying: 'Акаунта немає. Надсилаємо заявку ще раз…',
} as const

function failureText(outcome: Exclude<RegisterOutcome, { kind: 'registered' }>): string {
  if (outcome.kind === 'not-open') return 'Сервер ще відповідає ефіром.'
  if (outcome.kind === 'field') return REGISTER_CODE_MESSAGE[outcome.code] ?? outcome.code
  if (outcome.kind !== 'failed') return ''
  return (outcome.code && REGISTER_CODE_MESSAGE[outcome.code]) ?? `Помилка ${String(outcome.status ?? '')}.`
}

/** What to send the organizers about a failure on their side: time in UTC and X-Request-Id (spec 6, CL-37). */
function Report({ outcome }: { outcome: Exclude<RegisterOutcome, { kind: 'registered' }> }) {
  if (outcome.kind !== 'failed') return null
  // Only a failure on the server's side is worth a report: a 5xx or an answer that got lost.
  const serverSide = (outcome.status !== null && outcome.status >= 500) || outcome.lost
  if (!serverSide) return null
  return (
    <span className="report">
      Для організаторів: {formatUtc(outcome.at)}
      {outcome.status !== null && `, відповідь ${String(outcome.status)}`}
      {outcome.requestId && (
        <>
          , X-Request-Id <code>{outcome.requestId}</code>
        </>
      )}
      .
    </span>
  )
}

function StatusNote({ status }: { status: RegistrationStatus }) {
  switch (status.state) {
    case 'idle':
    case 'done':
    case 'armed':
      return null
    case 'checking':
      return <p className="note">Перевіряємо, чи відкрито просвіт…</p>
    case 'sending':
      return <p className="note">{STEP_TEXT[status.step]}</p>
    case 'retrying':
      return (
        <p className="note warn">
          {failureText(status.outcome)} Клієнт повторить сам о{' '}
          <span className="num">{formatLocalTime(status.atMs)}</span> (спроба {status.attempt + 1}). Не закривайте
          вкладку.
          <Report outcome={status.outcome} />
        </p>
      )
    case 'error': {
      const { outcome } = status
      if (outcome.kind === 'not-open') return <p className="note warn">Просвіт ще не відкрито: реєстрація не працює.</p>
      if (outcome.kind === 'closed') return <p className="note err">Просвіт минув, реєстрацію закрито.</p>
      if (outcome.kind === 'field') return <p className="note err">Виправте поле з позначкою.</p>
      if (outcome.kind === 'aborted') return null
      return (
        <p className="note err">
          {failureText(outcome)}
          {outcome.retryAfterSec !== null && ` Повторіть через ${String(outcome.retryAfterSec)} с.`}
          <Report outcome={outcome} />
        </p>
      )
    }
  }
}

/** The application: validated as typed, sent now or armed for the window (CL-16). */
export function RegisterForm() {
  const { draft, setDraft, errors, status, submit, arm, disarm } = useRegistration()
  const { station } = useEther()
  const sound = useRadioState()
  const busy = status.state === 'sending' || status.state === 'checking'
  // While armed the application waits for the window or repeats by itself: nothing is editable.
  const armed = status.state === 'armed' || status.state === 'retrying'
  const after = station.phase === 'after'
  const repo = parseRepository(draft.repository)
  const { server } = useServer()
  const fromEnv = draft.invitation !== '' && draft.invitation === envInvitation(server.id)
  // The code is one-time: hidden like a password, so it does not end up in a screen recording.
  const [showCode, setShowCode] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [repeat, setRepeat] = useState('')
  const [repeatError, setRepeatError] = useState<string | null>(null)

  /** The password is typed twice and offered to the password manager: only the organizers can replace it. */
  function passwordReady(): boolean {
    if (repeat !== draft.password) {
      setRepeatError('Паролі не збігаються. Введіть той самий пароль ще раз.')
      return false
    }
    setRepeatError(null)
    rememberPassword(normalizeUsername(draft.username), draft.password, draft.displayName)
    return true
  }

  function onSubmit(event: SubmitEvent) {
    event.preventDefault()
    if (!busy && passwordReady()) submit()
  }

  const error = (name: FormField) => (errors[name] ? <span className="ferr">{errors[name]}</span> : null)
  const bad = (name: FormField) => (errors[name] ? true : undefined)

  return (
    <>
      <WindowNote />
      <form className="formbox" onSubmit={onSubmit}>
        {armed && (
          <div className="armed" role="status">
            <i className="lamp" />
            <div>
              <b>Заявку заготовлено.</b> Клієнт надішле її сам за першим перевіреним кадром просвіту. Не закривайте
              вкладку: пароль і код заявки зберігаються тільки в ній.
              {sound.signals && !sound.unlocked && (
                <span className="armed-snd">
                  Звук поки заблоковано браузером: клацніть будь-де на сторінці, щоб почути відкриття просвіту.
                </span>
              )}
            </div>
          </div>
        )}
        <fieldset disabled={armed}>
          <div className="fgrid">
            <label className="fld">
              <span className="fl">Логін у мережі</span>
              <input
                autoComplete="username"
                aria-invalid={bad('username')}
                value={draft.username}
                onChange={(e) => {
                  setDraft({ username: e.target.value })
                }}
              />
              <span className="hint">3-32 знаки: латинська літера, далі літери, цифри, _ і -. Його ж пишете в .zoria.</span>
              {error('username')}
            </label>
            <label className="fld">
              <span className="fl">Ім'я в журналі</span>
              <input
                aria-invalid={bad('displayName')}
                value={draft.displayName}
                onChange={(e) => {
                  setDraft({ displayName: e.target.value })
                }}
              />
              <span className="hint warn">Це ім'я бачать усі в публічному журналі виходу на зв'язок.</span>
              {error('displayName')}
            </label>
            <label className="fld wide">
              <span className="fl">Код заявки</span>
              <span className="with-btn">
                <input
                  type={showCode ? 'text' : 'password'}
                  autoComplete="one-time-code"
                  spellCheck={false}
                  placeholder="код із листа або телеграму"
                  aria-invalid={bad('invitation')}
                  value={draft.invitation}
                  onChange={(e) => {
                    setDraft({ invitation: e.target.value })
                  }}
                />
                <button
                  type="button"
                  className="reveal"
                  aria-pressed={showCode}
                  onClick={() => {
                    setShowCode(!showCode)
                  }}
                >
                  {showCode ? 'сховати' : 'показати'}
                </button>
              </span>
              <span className="hint">
                {fromEnv
                  ? 'Код підставлено з .env.local. Він одноразовий: нікому його не передавайте.'
                  : 'Одноразовий код від організаторів: лист від watching@zoria.net або бот @zoria_net_bot.'}
              </span>
              {error('invitation')}
            </label>
            <label className="fld">
              <span className="fl">Пароль</span>
              <span className="with-btn">
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  aria-invalid={bad('password')}
                  value={draft.password}
                  onChange={(e) => {
                    setDraft({ password: e.target.value })
                  }}
                />
                <button
                  type="button"
                  className="reveal"
                  aria-pressed={showPassword}
                  onClick={() => {
                    setShowPassword(!showPassword)
                  }}
                >
                  {showPassword ? 'сховати' : 'показати'}
                </button>
              </span>
              <span className="hint">12-256 знаків. Збережіть його: змінити пароль можна лише за кодом від організаторів.</span>
              {error('password')}
            </label>
            <label className="fld">
              <span className="fl">Повторіть пароль</span>
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                aria-invalid={repeatError ? true : undefined}
                value={armed ? draft.password : repeat}
                onChange={(e) => {
                  setRepeat(e.target.value)
                  setRepeatError(null)
                }}
              />
              <span className="hint">Щоб помилка в одній літері не закрила вам вхід назавжди.</span>
              {repeatError && <span className="ferr">{repeatError}</span>}
            </label>
            <label className="fld wide">
              <span className="fl">Репозиторій</span>
              <input
                placeholder="owner/repo або https://github.com/owner/repo"
                aria-invalid={bad('repository')}
                value={draft.repository}
                onChange={(e) => {
                  setDraft({ repository: e.target.value })
                }}
              />
              {repo.ok ? (
                <span className="hint">
                  <code>{repo.url}</code> - має бути приватним, інакше заявка отримає «потребує уваги».
                </span>
              ) : (
                <span className="hint">Приватний репозиторій на GitHub: у відкритий бот допуску не заходить.</span>
              )}
              {error('repository')}
            </label>
            <div className="fld wide">
              <span className="fl">Мова листів сервера</span>
              <Seg
                label="Мова листів сервера"
                options={LANG_OPTIONS}
                value={draft.lang}
                disabled={armed}
                onChange={(lang: Lang) => {
                  setDraft({ lang })
                }}
              />
            </div>
          </div>
        </fieldset>

        <StatusNote status={status} />

        <div className="acts">
          <button type="submit" className="btn pri" disabled={busy || armed || after}>
            <Icon name="mast" />
            {after ? 'Реєстрацію закрито' : station.phase === 'window' ? 'Зареєструватися' : 'Надіслати зараз'}
          </button>
          {armed ? (
            <button type="button" className="btn" onClick={disarm}>
              <Icon name="close" />
              Скасувати заготовку
            </button>
          ) : (
            station.phase !== 'window' &&
            station.phase !== 'after' && (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => {
                  if (!passwordReady()) return
                  void askNotifications()
                  arm()
                }}
              >
                <Icon name="clock" />
                Заготувати й надіслати в просвіт
              </button>
            )
          )}
        </div>
      </form>
    </>
  )
}
