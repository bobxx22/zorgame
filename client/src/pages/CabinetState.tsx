import type { ReactNode } from 'react'
import { useAuth } from '../app/auth-context'
import { useCabinet } from '../app/cabinet-context'
import type { CabinetSnapshot } from '../cabinet/store'
import { formatLocalTime } from '../lib/time'
import { LoginForm } from './LoginForm'

/**
 * Wraps a cabinet screen: asks to log in when there is no session, explains
 * the static phase, shows the last problem and the sync time.
 */
export function CabinetScreen({
  title,
  children,
}: {
  title: string
  children: (cabinet: CabinetSnapshot) => ReactNode
}) {
  const { session } = useAuth()
  const cabinet = useCabinet()

  if (!session || !cabinet) {
    return (
      <section className="panel narrow">
        <h1>{title}</h1>
        <p className="muted">Увійдіть, щоб побачити кабінет.</p>
        <LoginForm />
      </section>
    )
  }

  return (
    <div className="stack">
      <div className="screen-head">
        <h1>{title}</h1>
        <span className="muted small">
          {cabinet.lastSyncMs !== null ? `оновлено о ${formatLocalTime(cabinet.lastSyncMs)}` : 'читаємо…'}
        </span>
      </div>
      {cabinet.noise && (
        <p className="banner warn-text">
          Станція в шумі: до просвіту сервер відповідає перешкодами. Кабінет оновиться, коли ефір стихне.
        </p>
      )}
      {cabinet.problem && <p className="banner err-text">{cabinet.problem}</p>}
      {children(cabinet)}
    </div>
  )
}
