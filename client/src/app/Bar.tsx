import { useEffect, useRef, useState } from 'react'
import { Link, NavLink } from 'react-router'
import { serverNow } from '../ether/station'
import { cls } from '../lib/cls'
import { formatDuration } from '../lib/time'
import { useNow } from '../lib/use-now'
import { LOOK_LABEL, lookCountdown, lookOf } from '../pages/ether-labels'
import { useRadio, useRadioState } from '../sound/radio-context'
import type { Channel } from '../sound/settings'
import { Icon } from '../ui/Icon'
import { Mark } from '../ui/Mark'
import { NAV_TOP, useNavCounts } from '../ui/nav'
import { RailNav } from '../ui/RailNav'
import { OnOff } from '../ui/Seg'
import { useAuth } from './auth-context'
import { useEther } from './ether-context'
import { useServer } from './server-context'

/** The on-air bar: the site's header, with the station's state on the right. */
export function Bar() {
  const counts = useNavCounts()
  const { server } = useServer()
  const [sheet, setSheet] = useState(false)

  useEffect(() => {
    if (!sheet) return
    document.body.classList.add('nav-open')
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSheet(false)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.classList.remove('nav-open')
      document.removeEventListener('keydown', onKey)
    }
  }, [sheet])

  const close = () => {
    setSheet(false)
  }

  return (
    <>
      <header className="bar">
        <Link className="brand" to="/" title="Зоря.нет - клієнт мережі">
          <Mark />
          <span className="wm">ЗОРЯ</span>
          <span className="wm-sub">клієнт</span>
        </Link>
        <span className="vr" />
        <nav className="nav" aria-label="Екрани">
          {NAV_TOP.map((item) => {
            const count = item.count ? counts[item.count] : 0
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end ?? false}
                className={({ isActive }) => cls(isActive && 'on')}
              >
                {item.label}
                {count > 0 && <span className="cnt num">{count}</span>}
              </NavLink>
            )
          })}
        </nav>
        <div className="right">
          {server.id !== 'prod' && (
            <span className="srv-tag" title={server.apiBase}>
              {server.id === 'stand' ? 'стенд' : 'локально'}
            </span>
          )}
          <OnAir />
          <SoundButton />
          <AccountBox />
          <button
            className="ib mnav"
            type="button"
            aria-label="Екрани"
            aria-expanded={sheet}
            onClick={() => {
              setSheet(true)
            }}
          >
            <Icon name="menu" />
          </button>
        </div>
      </header>
      {sheet && (
        <>
          <div className="sheet-bg" onClick={close} />
          <nav className="nsheet" aria-label="Екрани">
            <div className="sheet-h">
              <b>Екрани</b>
              <button className="ib" type="button" aria-label="Закрити" onClick={close}>
                <Icon name="close" />
              </button>
            </div>
            <RailNav onNavigate={close} />
            <SheetAccount onNavigate={close} />
          </nav>
        </>
      )}
    </>
  )
}

/** The faders of the sound popover: everything, the event signals with the crackle, the voice. */
const MIX: readonly { channel: Channel; label: string }[] = [
  { channel: 'master', label: 'Загальна' },
  { channel: 'signals', label: 'Сигнали' },
  { channel: 'voice', label: 'Голос' },
]

/** The station's phase with its count, always in sight. */
function OnAir() {
  const { station, listening } = useEther()
  const now = useNow()
  const look = lookOf(station)
  const count = lookCountdown(station, serverNow(station, now))
  return (
    <Link
      to="/"
      className={`onair look-${look}`}
      title={count ? `${LOOK_LABEL[look]}: ${count.label} ${formatDuration(count.ms)}` : `Ефір: ${LOOK_LABEL[look]}`}
    >
      <i className="lamp" />
      <span className="ol">{LOOK_LABEL[look]}</span>
      {count && <span className="oc num">{formatDuration(count.ms)}</span>}
      {!listening && <span className="op">пауза</span>}
    </Link>
  )
}

function SoundButton() {
  const radio = useRadio()
  const sound = useRadioState()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (box.current && event.target instanceof Node && !box.current.contains(event.target)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const blocked = sound.signals && !sound.unlocked
  const title = blocked
    ? 'Браузер ще не дозволив звук: клацніть будь-де на сторінці'
    : sound.signals
      ? 'Звук станції увімкнено (M)'
      : 'Звук станції вимкнено (M)'

  return (
    <div className="popwrap" ref={box}>
      <button
        type="button"
        className={cls('ib', sound.signals && 'on', blocked && 'blocked')}
        aria-label="Звук станції"
        aria-expanded={open}
        title={title}
        onClick={() => {
          radio.unlock()
          setOpen(!open)
        }}
      >
        <Icon name={sound.signals ? 'sound' : 'mute'} />
      </button>
      {open && (
        <div className="pop" role="dialog" aria-label="Звук станції">
          <p className="pop-h">Звук станції</p>
          <div className="pop-row">
            <span>Сигнали подій</span>
            <OnOff
              label="Сигнали подій"
              value={sound.signals}
              onChange={(on) => {
                radio.setSignals(on)
              }}
            />
          </div>
          <div className="pop-row">
            <span>Голос станції</span>
            <OnOff
              label="Голос станції"
              value={sound.voice}
              disabled={!sound.signals}
              onChange={(on) => {
                radio.setVoice(on)
              }}
            />
          </div>
          <p className="pop-sub">Гучність</p>
          {MIX.map(({ channel, label }) => {
            const percent = Math.round(sound.levels[channel] * 100)
            const off = channel === 'master' ? !sound.signals : !sound.signals || (channel === 'voice' && !sound.voice)
            return (
              <label key={channel} className="mix-row">
                <span>{label}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={percent}
                  disabled={off}
                  aria-label={`Гучність: ${label}`}
                  onChange={(e) => {
                    radio.setLevel(channel, Number(e.target.value) / 100)
                  }}
                  onPointerUp={() => {
                    radio.preview(channel)
                  }}
                  onKeyUp={(e) => {
                    if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') radio.preview(channel)
                  }}
                />
                <span className="num">{percent}%</span>
              </label>
            )
          })}
          {blocked && <p className="pop-note warn">Браузер ще не дозволив звук: клацніть будь-де на сторінці.</p>}
          <p className="pop-note">
            Звучать лише події: провісник, просвіт, реєстрація, лист, нова частина, збої. Клавіша <kbd>M</kbd> вимикає
            і вмикає все.
          </p>
          <button
            type="button"
            className="btn sm"
            disabled={!sound.signals}
            onClick={() => {
              radio.play({ sfx: 'window', voice: 'window-open' }, { force: true })
            }}
          >
            <Icon name="play" />
            Прослухати
          </button>
        </div>
      )}
    </div>
  )
}

/** The network has no password change or recovery: a stray click must not leave a participant outside. */
function confirmLogout(): boolean {
  return window.confirm('Вийти з акаунта?\n\nЗміни й відновлення пароля в мережі немає: переконайтеся, що пароль збережено.')
}

/** On a phone the account lives in the sheet: the bar has no room for it. */
function SheetAccount({ onNavigate }: { onNavigate: () => void }) {
  const { session, logout } = useAuth()
  return (
    <div className="rgroup">
      <p className="rh">Акаунт</p>
      {session ? (
        <div className="sheet-acc">
          <span className="acc-name">
            <Icon name="user" />
            {session.user.username}
          </span>
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              if (!confirmLogout()) return
              onNavigate()
              void logout()
            }}
          >
            <Icon name="out" />
            Вийти
          </button>
        </div>
      ) : (
        <Link className="btn sm" to="/contact" state={{ mode: 'login' }} onClick={onNavigate}>
          <Icon name="user" />
          Увійти
        </Link>
      )}
    </div>
  )
}

function AccountBox() {
  const { session, logout } = useAuth()
  if (!session) {
    return (
      <Link className="btn sm acc-in" to="/contact" state={{ mode: 'login' }}>
        <Icon name="user" />
        Увійти
      </Link>
    )
  }
  return (
    <div className="acc">
      <Link to="/contact" className="acc-name" title={`${session.user.displayName} - заявка і доступ`}>
        <Icon name="user" />
        <span>{session.user.username}</span>
      </Link>
      <button
        className="ib"
        type="button"
        title="Вийти"
        aria-label="Вийти"
        onClick={() => {
          if (!confirmLogout()) return
          void logout()
        }}
      >
        <Icon name="out" />
      </button>
    </div>
  )
}
