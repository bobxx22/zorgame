import { useRef } from 'react'
import { Outlet, useLocation } from 'react-router'
import { StationSounds } from '../sound/StationSounds'
import { ArmedGuard } from './ArmedGuard'
import { Bar } from './Bar'
import { ErrorBoundary } from './ErrorBoundary'
import { Foot } from './Foot'
import { SessionGuard } from './SessionUi'
import { StationNotices } from './StationNotices'

export function Layout() {
  const main = useRef<HTMLElement>(null)
  const { pathname } = useLocation()
  return (
    <>
      <button
        type="button"
        className="skip"
        onClick={() => {
          main.current?.focus()
        }}
      >
        До змісту
      </button>
      <Bar />
      <SessionGuard />
      <ArmedGuard />
      <main id="main" ref={main} tabIndex={-1}>
        <ErrorBoundary key={pathname} scope="screen">
          <Outlet />
        </ErrorBoundary>
      </main>
      <Foot />
      <StationSounds />
      <StationNotices />
    </>
  )
}
