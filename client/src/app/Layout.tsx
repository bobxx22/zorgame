import { NavLink, Outlet } from 'react-router'
import type { ServerId } from '../config/servers'
import { PHASE_LABEL } from '../pages/ether-labels'
import { Clock } from './Clock'
import { AccountBox, SessionGuard } from './SessionUi'
import { useEther } from './ether-context'
import { useServer } from './server-context'

const NAV = [
  { to: '/', label: 'Ефір', end: true },
  { to: '/register', label: 'Реєстрація' },
  { to: '/access', label: 'Доступ' },
  { to: '/inbox', label: 'Листи' },
  { to: '/news', label: 'Новини' },
  { to: '/stages', label: 'Завдання' },
  { to: '/roll', label: 'Журнал' },
]

export function Layout() {
  const { server, servers, selectServer } = useServer()
  const { station, listening } = useEther()
  const phase = station.phase

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" aria-hidden="true" />
          ЗОРЯ.НЕТ
        </div>
        <nav className="nav">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end ?? false}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="topbar-right">
          <label className="server-switch">
            <span className="muted">Сервер</span>
            <select
              value={server.id}
              onChange={(e) => {
                selectServer(e.target.value as ServerId)
              }}
            >
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <Clock />
          <AccountBox />
        </div>
      </header>
      <main className="content">
        <SessionGuard />
        <Outlet />
      </main>
      <footer className="statusbar mono">
        <span className={server.id === 'prod' ? 'tag tag-prod' : 'tag'}>{server.id}</span>
        <span className="muted">{server.apiBase}</span>
        <span className="statusbar-right">
          ефір:{' '}
          <span className={`phase-text phase-${phase ?? 'unknown'}`}>{phase ? PHASE_LABEL[phase] : 'невідомо'}</span>
          {!listening && <span className="muted"> (пауза)</span>}
        </span>
      </footer>
    </div>
  )
}
