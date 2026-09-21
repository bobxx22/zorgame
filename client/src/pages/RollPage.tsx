import { useEffect, useState } from 'react'
import { useEther, useEtherListener } from '../app/ether-context'
import { formatDuration, formatLocal, formatLocalTime, zoneLabel } from '../lib/time'

/** Public roll of the window: number, local time, display name (CL-34). */
export function RollPage() {
  const listener = useEtherListener()
  const { station } = useEther()
  const [me, setMe] = useState('')

  useEffect(() => listener.wantRoll(), [listener])

  const roll = station.roll
  const needle = me.trim().toLowerCase()

  return (
    <section className="panel">
      <h1>Журнал виходу на зв'язок</h1>
      <p className="muted small">
        Оновлюється не частіше ніж раз на хвилину. Час - {zoneLabel()}.
        {roll && <> Стан на {formatLocalTime(roll.atMs)}.</>}
      </p>
      <label className="row">
        <span className="muted">Знайти себе</span>
        <input
          value={me}
          placeholder="відображуване ім'я"
          onChange={(e) => {
            setMe(e.target.value)
          }}
        />
      </label>
      {!roll ? (
        <p className="muted">Журнал ще не отримано.</p>
      ) : roll.entries.length === 0 ? (
        <p className="muted">У журналі ще нікого немає: реєстрація відкривається в просвіт.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>№</th>
              <th>час</th>
              <th>від відкриття</th>
              <th>ім'я</th>
            </tr>
          </thead>
          <tbody>
            {roll.entries.map((entry) => (
              <tr key={entry.n} className={needle && entry.name.toLowerCase() === needle ? 'me' : ''}>
                <td className="mono">{entry.n}</td>
                <td className="mono">{formatLocal(entry.at)}</td>
                <td className="mono">{formatDuration(entry.sinceOpen * 1000)}</td>
                <td>{entry.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
