import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router'
import { useAuth } from '../app/auth-context'
import { useCabinet } from '../app/cabinet-context'
import { useEther } from '../app/ether-context'
import { useRegistration } from '../app/registration-context'
import { serverNow } from '../ether/station'
import { useNow } from '../lib/use-now'
import { CLOSING_WARNING_MS, detectCues, tickSecond, type Watch } from './cues'
import { useRadio } from './radio-context'

/** Turns what the client sees into station sounds. Renders nothing. */
export function StationSounds() {
  const radio = useRadio()
  const { station, counts } = useEther()
  const { session, lost } = useAuth()
  const { status } = useRegistration()
  const cabinet = useCabinet()
  const { pathname } = useLocation()
  const now = useNow(5_000)
  const srvNow = serverNow(station, now)

  const phase = station.phase
  const opensAtMs = phase === 'static' ? station.opensAtMs : null
  const jams = (counts.jammed ?? 0) + (counts['rate-limited'] ?? 0)
  const registered = status.state === 'done'
  const access = cabinet?.repository ? cabinet.repository.accessStatus : null
  const released = cabinet?.summary?.releasedStages ?? null
  const unread = cabinet?.summary?.unread ?? null
  const closingSoon =
    phase === 'window' && !session && station.window !== null && station.window.closesAtMs - srvNow < CLOSING_WARNING_MS

  const previous = useRef<Watch | null>(null)
  useEffect(() => {
    const next: Watch = { phase, opensAtMs, jams, registered, lost, access, released, unread, closingSoon }
    for (const cue of detectCues(previous.current, next)) radio.play(cue)
    previous.current = next
  }, [radio, phase, opensAtMs, jams, registered, lost, access, released, unread, closingSoon])

  // A new screen is a new frame: a short crackle, as in the intro.
  const seenPath = useRef<string | null>(null)
  useEffect(() => {
    if (seenPath.current !== null && seenPath.current !== pathname) radio.crackle()
    seenPath.current = pathname
  }, [radio, pathname])

  // The last ten seconds before the window tick once a second.
  const offset = station.clockOffsetMs ?? 0
  const soon = opensAtMs !== null && opensAtMs - srvNow < 20_000
  // Kept across restarts: a fresh frame moves opensAt by milliseconds and must not repeat a second.
  const lastTick = useRef<number | null>(null)
  useEffect(() => {
    if (opensAtMs === null || !soon) return
    const timer = window.setInterval(() => {
      const second = tickSecond(opensAtMs, Date.now() + offset)
      if (second !== null && second !== lastTick.current) radio.play({ sfx: 'tick' })
      lastTick.current = second
    }, 200)
    return () => {
      window.clearInterval(timer)
    }
  }, [radio, opensAtMs, offset, soon])

  return null
}
