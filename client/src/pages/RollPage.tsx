import { useEffect, useState } from 'react'
import { useAuth } from '../app/auth-context'
import { useEther, useEtherListener } from '../app/ether-context'
import { cls } from '../lib/cls'
import { formatDuration, formatLocal, formatLocalTime, zoneLabel } from '../lib/time'
import { DocPage } from '../ui/DocPage'
import { Icon } from '../ui/Icon'
import { VALLEY_SCENE } from '../ui/scenes'
import type { RollEntry } from '../ether/frame'
import { findOwnEntry } from './roll-match'

/** Public roll of the window: number, local time, display name (CL-34). */
export function RollPage() {
  const listener = useEtherListener()
  const { station } = useEther()
  const { session } = useAuth()
  const [typed, setTyped] = useState<string | null>(null)
  // Untouched, the field shows the session's name and the own line is found by the moment of registration.
  const me = typed ?? session?.user.displayName ?? ''

  useEffect(() => listener.wantRoll(), [listener])

  const roll = station.roll
  const needle = me.trim().toLowerCase()
  const own = typed === null && session && roll ? findOwnEntry(roll.entries, session.user) : undefined
  const isHit = (entry: RollEntry) =>
    typed === null ? entry.n === own?.n : needle !== '' && entry.name.toLowerCase() === needle
  const hits = roll ? roll.entries.filter(isHit) : []
  const found = hits[0]

  return (
    <DocPage
      crumbs={[{ to: '/', label: 'Ефір' }]}
      here="Журнал"
      title="Журнал виходу на зв'язок"
      lead="Публічний журнал просвіту: номер, час виходу і ім'я. Клієнт оновлює його не частіше ніж раз на хвилину і лише поки ви на цьому екрані."
      meta={
        <>
          <span>
            <Icon name="roll" />у журналі: {roll?.entries.length ?? station.onAir ?? '—'}
          </span>
          <span>
            <Icon name="refresh" />
            {roll ? `стан на ${formatLocalTime(roll.atMs)}` : 'ще не отримано'}
          </span>
          <span>
            <Icon name="clock" />
            {zoneLabel()}
          </span>
        </>
      }
      toc={
        <div className="sidebox">
          <p className="rh">Ви в журналі</p>
          {found ? (
            <ul className="side-kv">
              <li>
                <span>номер</span>
                <b className="num">{found.n}</b>
              </li>
              <li>
                <span>вихід</span>
                <b className="num">{formatLocal(found.at)}</b>
              </li>
              <li>
                <span>від відкриття</span>
                <b className="num">{formatDuration(found.sinceOpen * 1000)}</b>
              </li>
            </ul>
          ) : (
            <p>{needle ? 'Такого імені в журналі поки немає.' : 'Введіть своє ім’я в журналі, щоб знайти рядок.'}</p>
          )}
          {hits.length > 1 && <p>Це ім’я в журналі не одне: рядків {hits.length}. Свій - той, що за часом реєстрації.</p>}
        </div>
      }
    >
      <figure className="art">
        <img src={VALLEY_SCENE} alt="" width="1200" height="670" />
        <figcaption>Долина станцій згори. Кожен рядок журналу - оператор, що вийшов на зв'язок у просвіт.</figcaption>
      </figure>
      <label className="fld search">
        <span className="fl">Знайти себе</span>
        <input
          value={me}
          placeholder="ім'я в журналі"
          onChange={(e) => {
            setTyped(e.target.value)
          }}
        />
      </label>
      {!roll ? (
        <p className="note">Журнал ще не отримано.</p>
      ) : roll.entries.length === 0 ? (
        <p className="note">У журналі ще нікого немає: реєстрація відкривається в просвіт.</p>
      ) : (
        <div className="tbl roll">
          <table>
            <thead>
              <tr>
                <th>Номер</th>
                <th>Час виходу</th>
                <th>Від відкриття</th>
                <th>Ім'я</th>
              </tr>
            </thead>
            <tbody>
              {roll.entries.map((entry) => (
                <tr key={entry.n} className={cls(isHit(entry) && 'me')}>
                  <td data-label="Номер" className="num">
                    {entry.n}
                  </td>
                  <td data-label="Час виходу" className="num">
                    {formatLocal(entry.at)}
                  </td>
                  <td data-label="Від відкриття" className="num">
                    {formatDuration(entry.sinceOpen * 1000)}
                  </td>
                  <td data-label="Ім'я">{entry.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DocPage>
  )
}
