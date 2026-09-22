import { useState, type SubmitEvent } from 'react'
import { useAuth } from '../app/auth-context'
import { useServer } from '../app/server-context'
import { parseSession } from '../auth/schemas'
import { normalizeUsername } from '../auth/validate'
import { LOGIN_CODE_MESSAGE } from './auth-labels'

/** Login by name and password. Errors stay next to the form; input is kept (CL-37). */
export function LoginForm({ onDone }: { onDone?: () => void }) {
  const { api } = useServer()
  const { setSession } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function login() {
    setBusy(true)
    setError(null)
    const result = await api.call({
      method: 'POST',
      path: '/auth/login',
      body: { username: normalizeUsername(username), password },
      parse: parseSession,
      retry: { transient: true, busy: true, maxAttempts: 3 },
    })
    setBusy(false)
    if (result.ok) {
      setPassword('')
      setSession(result.data)
      onDone?.()
      return
    }
    const { error: failure } = result
    const code = failure.kind === 'http' ? failure.code : failure.kind === 'network' ? failure.reason : null
    const requestId = failure.kind === 'http' && failure.status >= 500 ? failure.requestId : null
    setError(
      (code && LOGIN_CODE_MESSAGE[code]) ??
        `Не вдалося увійти${requestId ? ` (X-Request-Id: ${requestId})` : ''}.`,
    )
  }

  function onSubmit(event: SubmitEvent) {
    event.preventDefault()
    if (!busy) void login()
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <label className="field">
        <span>Логін</span>
        <input
          autoComplete="username"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value)
          }}
        />
      </label>
      <label className="field">
        <span>Пароль</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
          }}
        />
      </label>
      {error && <p className="err-text small">{error}</p>}
      <div className="row">
        <button type="submit" className="primary" disabled={busy || !username || !password}>
          {busy ? 'Входимо…' : 'Увійти'}
        </button>
      </div>
    </form>
  )
}
