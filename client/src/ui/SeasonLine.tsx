import { SEASON_EVENTS, seasonPercent } from '../config/season'

const DAYS = 31
const WEEKS = ['21.09', '28.09', '05.10', '12.10', '19.10']

const pct = (value: number) => `${value.toFixed(2)}%`

/** The site's season line, with the moment the client lives in marked on it. */
export function SeasonLine({ nowMs }: { nowMs: number }) {
  const now = seasonPercent(nowMs)
  return (
    <>
      <div className="tl" aria-hidden="true">
        <div className="evs">
          {SEASON_EVENTS.map((event, i) => {
            const left = seasonPercent(event.from) ?? 0
            // The last labels hang to the left of their mark, or they would leave the page.
            return (
              <div
                key={event.label}
                className={`m ${event.kind} r${String(i % 2)}${left > 92 ? ' end' : ''}`}
                style={{ left: pct(left) }}
              >
                <b>{event.label}</b>
                <span className="num">{event.day}</span>
              </div>
            )
          })}
        </div>
        <div className="track">
          {SEASON_EVENTS.map((event) => {
            const left = seasonPercent(event.from) ?? 0
            if (event.to) {
              const right = seasonPercent(event.to) ?? left
              return <span key={event.label} className={`band ${event.kind}`} style={{ left: pct(left), width: pct(right - left) }} />
            }
            return <span key={event.label} className={`dot ${event.kind}`} style={{ left: pct(left) }} />
          })}
          {now !== null && (
            <span className="now" style={{ left: pct(now) }}>
              <b>зараз</b>
            </span>
          )}
        </div>
        <div className="ruler">
          {Array.from({ length: DAYS + 1 }, (_, day) => (
            <i key={day} className={day % 7 === 0 ? 'w' : ''} style={{ left: pct((day / DAYS) * 100) }} />
          ))}
          {WEEKS.map((label, week) => (
            <span key={label} className="num" style={{ left: pct(((week * 7) / DAYS) * 100) }}>
              {label}
            </span>
          ))}
        </div>
      </div>
      <ol className="tl-list">
        {SEASON_EVENTS.map((event) => (
          <li key={event.label} className={event.kind}>
            <span className="num">{event.day}</span>
            <b>{event.label}</b>
          </li>
        ))}
      </ol>
    </>
  )
}
