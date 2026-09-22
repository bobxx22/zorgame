import { useState } from 'react'
import { Link } from 'react-router'
import { EXPIRY_WARNING_MS } from '../auth/session-store'
import { formatLocal } from '../lib/time'
import { useNow } from '../lib/use-now'
import { LoginForm } from '../pages/LoginForm'
import { useAuth } from './auth-context'

/** Account name and logout in the top bar. */
export function AccountBox() {
  const { session, logout } = useAuth()
  if (!session) {
    return (
      <Link className="small" to="/register">
        Увійти / зареєструватися
      </Link>
    )
  }
  return (
    <div className="account small">
      <span className="mono">{session.user.username}</span>
      <button
        type="button"
        className="link-button"
        onClick={() => {
          void logout()
        }}
      >
        вийти
      </button>
    </div>
  )
}

/**
 * Warns before the session ends (CL-22) and, when it ended while in use (401
 * or expiry), opens login over the current screen so nothing typed is lost (CL-21).
 */
export function SessionGuard() {
  const { session, lost, dismissLost } = useAuth()
  const now = useNow(30_000)
  const [relogin, setRelogin] = useState(false)
  const left = session ? Date.parse(session.expiresAt) - now : null

  return (
    <>
      {session && !lost && left !== null && left < EXPIRY_WARNING_MS && (
        <div className="banner warn-text">
          Сесія закінчиться о {formatLocal(session.expiresAt)}.{' '}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setRelogin(true)
            }}
          >
            Увійти знову
          </button>
        </div>
      )}
      {(lost || relogin) && (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="relogin-title">
          <div className="panel dialog">
            <h2 id="relogin-title">{lost ? 'Сесія закінчилася' : 'Продовжити сесію'}</h2>
            <p className="muted small">Увійдіть, щоб продовжити. Введене на сторінці збережено.</p>
            <LoginForm
              onDone={() => {
                setRelogin(false)
              }}
            />
            <button
              type="button"
              className="link-button small"
              onClick={() => {
                setRelogin(false)
                dismissLost()
              }}
            >
              Закрити
            </button>
          </div>
        </div>
      )}
    </>
  )
}
