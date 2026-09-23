import { useRef } from 'react'
import { Outlet } from 'react-router'
import { StationSounds } from '../sound/StationSounds'
import { ArmedGuard } from './ArmedGuard'
import { Bar } from './Bar'
import { Foot } from './Foot'
import { SessionGuard } from './SessionUi'

export function Layout() {
  const main = useRef<HTMLElement>(null)
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
        <Outlet />
      </main>
      <Foot />
      <StationSounds />
    </>
  )
}
