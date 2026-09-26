import { useState, type SubmitEvent } from 'react'
import { useServer } from '../app/server-context'
import { checkPassword } from '../auth/validate'
import { useUnmountSignal } from '../lib/use-unmount-signal'
import { Icon } from '../ui/Icon'

/**
 * A new password by the one-time code the organizers give on request (FAQ of
 * 25.09): POST /auth/recover {token, password}. The route is not in contract
 * 1.1.0, so any 2xx counts as done and the body is not read. The old password
 * holds until the code is used; after it every old session of the account ends.
 */
export function RecoverForm() {
  const { api } = useServer()
  const unmountSignal = useUnmountSignal()
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  async function recover() {
    const problem =
      code.trim() === ''
        ? 'Вкажіть код від організаторів.'
        : (checkPassword(password) ?? (repeat !== password ? 'Паролі не збігаються.' : null))
    if (problem) {
      setNote({ ok: false, text: problem })
      return
    }
    setBusy(true)
    setNote(null)
    const signal = unmountSignal()
    const result = await api.call({
      method: 'POST',
      path: '/auth/recover',
      body: { token: code.trim(), password },
      parse: () => true,
      retry: { transient: false, busy: true, maxAttempts: 3 },
      signal,
    })
    if (signal.aborted) return
    setBusy(false)
    if (result.ok) {
      setCode('')
      setPassword('')
      setRepeat('')
      setNote({ ok: true, text: 'Пароль змінено. Увійдіть новим паролем; старі входи цього акаунта закрито.' })
      return
    }
    const { error } = result
    const text =
      error.kind === 'http' && error.code === 'invalid-recovery'
        ? 'Код чужий, уже використаний або прострочений. Попросіть в організаторів новий.'
        : error.kind === 'http' && error.field === 'password'
          ? 'Сервер не прийняв пароль: 12-256 знаків.'
          : error.kind === 'http' && error.status === 429
            ? 'Забагато спроб. Зачекайте хвилину.'
            : error.kind === 'network'
              ? 'Немає зв’язку з сервером. Спробуйте ще раз; якщо код уже спрацював, увійдіть новим паролем.'
              : `Не вдалося змінити пароль${error.kind === 'http' && error.requestId ? ` (X-Request-Id: ${error.requestId})` : ''}.`
    setNote({ ok: false, text })
  }

  function onSubmit(event: SubmitEvent) {
    event.preventDefault()
    if (!busy) void recover()
  }

  if (!open) {
    return (
      <p className="note">
        <button
          type="button"
          className="lk"
          onClick={() => {
            setOpen(true)
          }}
        >
          Загубили пароль?
        </button>
      </p>
    )
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <p className="note">
        Напишіть організаторам тим самим каналом, яким подавали заявку: вони видадуть одноразовий код. Поки код не
        використано, старий пароль діє.
      </p>
      <div className="fgrid">
        <label className="fld wide">
          <span className="fl">Код від організаторів</span>
          <input
            autoComplete="one-time-code"
            spellCheck={false}
            value={code}
            onChange={(e) => {
              setCode(e.target.value)
            }}
          />
        </label>
        <label className="fld">
          <span className="fl">Новий пароль</span>
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
            }}
          />
        </label>
        <label className="fld">
          <span className="fl">Повторіть пароль</span>
          <input
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(e) => {
              setRepeat(e.target.value)
            }}
          />
        </label>
      </div>
      {note && <p className={note.ok ? 'callout ok' : 'note err'}>{note.text}</p>}
      <div className="acts">
        <button type="submit" className="btn" disabled={busy}>
          <Icon name="key" />
          {busy ? 'Змінюємо…' : 'Задати новий пароль'}
        </button>
      </div>
    </form>
  )
}
