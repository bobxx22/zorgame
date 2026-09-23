import type { ReactNode } from 'react'
import { useAuth } from '../app/auth-context'
import { useCabinet } from '../app/cabinet-context'
import type { CabinetSnapshot } from '../cabinet/store'
import { formatLocalTime } from '../lib/time'
import { DocPage, type Crumb } from '../ui/DocPage'
import { Icon } from '../ui/Icon'
import { Shut } from './AccessSections'
import { LoginForm } from './LoginForm'

const HOME: readonly Crumb[] = [{ to: '/', label: 'Ефір' }]

/**
 * A cabinet screen as a document: asks to log in when there is no session,
 * explains the static phase, shows the last problem and the sync time.
 */
export function CabinetDoc({
  crumbs = HOME,
  here,
  title,
  lead,
  meta,
  toc,
  wide = false,
  children,
}: {
  crumbs?: readonly Crumb[]
  here: string
  title: ReactNode
  lead?: ReactNode
  meta?: (cabinet: CabinetSnapshot) => ReactNode
  toc?: (cabinet: CabinetSnapshot) => ReactNode
  wide?: boolean
  children: (cabinet: CabinetSnapshot) => ReactNode
}) {
  const { session } = useAuth()
  const cabinet = useCabinet()

  if (!session || !cabinet) {
    return (
      <DocPage crumbs={crumbs} here={here} title={title} lead={lead}>
        <Shut>Це розділ кабінету: увійдіть, щоб його побачити.</Shut>
        <div className="formbox">
          <LoginForm />
        </div>
      </DocPage>
    )
  }

  return (
    <DocPage
      crumbs={crumbs}
      here={here}
      title={title}
      lead={lead}
      wide={wide}
      meta={
        <>
          {meta?.(cabinet)}
          <span>
            <Icon name="refresh" />
            {cabinet.lastSyncMs !== null ? `оновлено о ${formatLocalTime(cabinet.lastSyncMs)}` : 'читаємо…'}
          </span>
        </>
      }
      toc={toc?.(cabinet)}
    >
      {cabinet.noise && (
        <p className="callout warn">
          Станція в шумі: до просвіту сервер відповідає перешкодами. Кабінет оновиться, коли ефір стихне.
        </p>
      )}
      {cabinet.problem && <p className="callout err">{cabinet.problem}</p>}
      {children(cabinet)}
    </DocPage>
  )
}
