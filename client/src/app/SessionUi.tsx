import { useState } from 'react'
import { EXPIRY_WARNING_MS } from '../auth/session-store'
import { formatLocal } from '../lib/time'
import { useNow } from '../lib/use-now'
import { LoginForm } from '../pages/LoginForm'
import { Icon } from '../ui/Icon'
import { useAuth } from './auth-context'

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
        <div className="strip" role="status">
          <Icon name="clock" />
          <span>
            Сесія закінчиться о <span className="num">{formatLocal(session.expiresAt)}</span>.
          </span>
          <button
            type="button"
            className="lk"
            onClick={() => {
              setRelogin(true)
            }}
          >
            Увійти знову
          </button>
        </div>
      )}
      {(lost || relogin) && (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="relogin-title">
          <div className="modal-box">
            <div className="modal-h">
              <h2 id="relogin-title">{lost ? "Зв'язок втрачено" : 'Продовжити сесію'}</h2>
              <button
                type="button"
                className="ib"
                aria-label="Закрити"
                onClick={() => {
                  setRelogin(false)
                  dismissLost()
                }}
              >
                <Icon name="close" />
              </button>
            </div>
            <p className="modal-lead">
              {lost ? 'Сесія закінчилася. ' : ''}Назвіть себе знову: введене на сторінці збережено.
            </p>
            <LoginForm
              onDone={() => {
                setRelogin(false)
              }}
            />
          </div>
        </div>
      )}
    </>
  )
}
