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
import { standingOf, standingText, type Field, type Standing } from '../cabinet/field'
import { useField } from './use-field'

/** A roll name with its fate after the group stage: crossed out in red for those who left. */
function RollName({ name, mark }: { name: string; mark: { login: string; standing: Standing } | null }) {
  if (!mark) return <>{name}</>
  const why = standingText(mark.standing)
  const title = mark.login === name ? why : `${mark.login}: ${why}`
  if (mark.standing.kind === 'second') {
    return (
      <span className="fate alive" title={title}>
        {name} <span className="fate-tag">другий етап</span>
      </span>
    )
  }
  return (
    <span className="fate gone" title={title}>
      <span className="fate-x" aria-hidden="true">✖</span>
      {name}
      <span className="sr"> - {why}</span>
    </span>
  )
}

/** The totals of the group stage and how many roll names could be tied to a login. */
function FieldBox({ field, problem, known, total }: { field: Field | null; problem: string | null; known: number; total: number }) {
  return (
    <div className="sidebox">
      <p className="rh">Після групового етапу</p>
      {field ? (
        <>
          <ul className="side-kv">
            <li>
              <span>другий етап</span>
              <b className="num fate alive">{field.second.length}</b>
            </li>
            <li>
              <span>вибули в групах</span>
              <b className="num fate gone">{field.out.length}</b>
            </li>
            <li>
              <span>не допущені</span>
              <b className="num fate gone">{field.struck.length}</b>
            </li>
            <li>
              <span>зареєстровано</span>
              <b className="num">{field.registered}</b>
            </li>
          </ul>
          <p>
            Журнал показує імена, а підсумки - логіни. Впізнано {known} з {total}: ім'я збігається з логіном або
            людина траплялася вам в іграх. Решта рядків без позначки.
          </p>
        </>
      ) : (
        <p>{problem ? `Підсумків немає: ${problem}.` : 'Читаємо підсумки з сайту…'}</p>
      )}
    </div>
  )
}

function standingFor(field: Field, login: string): string {
  const standing = field.byLogin.get(login)
  return standing ? standingText(standing) : login
}

/** Everyone of the draw by login: the full answer, also for the names the roll could not tie. */
function FieldLists({ field }: { field: Field }) {
  const rows: [string, readonly string[], string][] = [
    ['Другий етап', field.second, 'alive'],
    ['Вибули в груповому етапі', field.out, 'gone'],
    ['Не допущені до групового етапу', field.struck, 'gone'],
  ]
  return (
    <details className="field-lists">
      <summary>Усі учасники за логінами</summary>
      {rows.map(([title, logins, look]) => (
        <section key={title}>
          <h3>
            {title}: {logins.length}
          </h3>
          <p className="field-names">
            {logins.map((login) => (
              <span key={login} className={cls('fate', look)} title={standingFor(field, login)}>
                {look === 'gone' && (
                  <span className="fate-x" aria-hidden="true">
                    ✖
                  </span>
                )}
                {login}
              </span>
            ))}
          </p>
        </section>
      ))}
    </details>
  )
}

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
  const { field, aliases, problem } = useField()
  const markOf = (entry: RollEntry) => {
    if (!field) return null
    /* one's own line: the session knows its login, whatever the display name */
    const mine = session && own && entry.n === own.n ? field.byLogin.get(session.user.username) : undefined
    return session && mine ? { login: session.user.username, standing: mine } : standingOf(field, entry.name, aliases)
  }
  const known = roll && field ? roll.entries.filter((entry) => markOf(entry) !== null).length : 0

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
        <>
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
          <FieldBox field={field} problem={problem} known={known} total={roll?.entries.length ?? 0} />
        </>
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
                  <td data-label="Ім'я">
                    <RollName name={entry.name} mark={markOf(entry)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {field && <FieldLists field={field} />}
    </DocPage>
  )
}
