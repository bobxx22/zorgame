import { useEffect, useRef } from 'react'
import { Icon } from '../ui/Icon'
import { notify } from './notifications'
import { useEther, useEtherListener } from './ether-context'
import { isArmedOn, useRegistration, type RegistrationStatus } from './registration-context'
import { useServer } from './server-context'

/**
 * An armed application goes out only from an open tab that listens to the
 * live ether. This keeps the screen awake while it waits, sends a system
 * notification when the window opens and when it is done, and says so when
 * something stops it: the listener paused, or another server chosen.
 */
export function ArmedGuard() {
  const { server, servers, selectServer } = useServer()
  const listener = useEtherListener()
  const { listening } = useEther()
  const { status } = useRegistration()
  const armedHere = status.state === 'armed' || status.state === 'retrying'
  const armedOnProd = server.id !== 'prod' && isArmedOn('prod')
  const prod = servers.find((s) => s.id === 'prod')

  useWakeLock(armedHere && listening)
  useArmedNotifications(status)

  return (
    <>
      {armedHere && !listening && (
        <div className="strip warn" role="alert">
          <Icon name="pause" />
          <span>Заявку заготовлено, але прослуховування ефіру на паузі: у просвіт вона не піде.</span>
          <button
            type="button"
            className="lk"
            onClick={() => {
              listener.start()
            }}
          >
            Слухати
          </button>
        </div>
      )}
      {armedOnProd && prod && (
        <div className="strip warn" role="alert">
          <Icon name="mast" />
          <span>
            Заявку заготовлено для бойового сервера, а обрано «{server.label}»: бойовий ефір зараз ніхто не слухає.
          </span>
          <button
            type="button"
            className="lk"
            onClick={() => {
              selectServer('prod')
            }}
          >
            Повернутися на бойовий
          </button>
        </div>
      )}
    </>
  )
}

/** Screen Wake Lock while armed: a sleeping computer sends nothing. Released when the tab hides; taken again. */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let cancelled = false
    const acquire = () => {
      if (document.visibilityState !== 'visible' || (lock && !lock.released)) return
      navigator.wakeLock.request('screen').then(
        (sentinel) => {
          if (cancelled) void sentinel.release()
          else lock = sentinel
        },
        () => undefined,
      )
    }
    acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', acquire)
      if (lock) void lock.release()
    }
  }, [active])
}

/** System notifications for the armed application: sent, done, stopped. */
function useArmedNotifications(status: RegistrationStatus) {
  const previous = useRef(status.state)
  const announced = useRef(false)
  useEffect(() => {
    const before = previous.current
    previous.current = status.state
    if (before === status.state) return
    if (status.state === 'idle') announced.current = false
    if (before === 'armed' && status.state === 'sending' && !announced.current) {
      // Once: the armed loop passes through "armed" again before every repeat.
      announced.current = true
      notify('Просвіт відкрито', 'Клієнт надсилає заготовлену заявку.')
    } else if (status.state === 'done') {
      notify('Ви на зв’язку', 'Реєстрацію виконано. Далі - запрошення і файл .zoria.')
    } else if (status.state === 'error' && (before === 'sending' || before === 'retrying')) {
      notify('Заявку не прийнято', 'Відкрийте клієнт: потрібна ваша дія.')
    }
  }, [status.state])
}
