import { NavLink, Outlet } from 'react-router'
import type { ServerId } from '../config/servers'
import { Clock } from './Clock'
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
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
      <footer className="statusbar mono">
        <span className={server.id === 'prod' ? 'tag tag-prod' : 'tag'}>{server.id}</span>
        <span className="muted">{server.apiBase}</span>
      </footer>
    </div>
  )
}
