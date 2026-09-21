import { useEffect, useState } from 'react'
import { formatLocal, zoneLabel } from '../lib/time'

/** Local time with the zone named (CL-38). Server time sync comes with /me/summary. */
export function Clock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date())
    }, 1000)
    return () => {
      window.clearInterval(timer)
    }
  }, [])

  return (
    <div className="clock" title="Сервер працює в UTC; тут показано ваш місцевий час">
      <span className="mono">{formatLocal(now)}</span>
      <span className="muted">{zoneLabel(now)}</span>
    </div>
  )
}
