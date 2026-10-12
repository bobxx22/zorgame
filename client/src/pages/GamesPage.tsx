import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useAuth } from '../app/auth-context'
import { useCabinetStore } from '../app/cabinet-context'
import { useServer } from '../app/server-context'
import { describeFailure } from '../cabinet/store'
import type { GameRow, PackView, RecordFile } from '../cabinet/submission'
import { formatLocal } from '../lib/time'
import { Icon } from '../ui/Icon'
import { CabinetDoc } from './CabinetDoc'

const GAMES = [{ to: '/', label: 'Ефір' }, { to: '/games', label: 'Ігри' }] as const

/**
 * The answer as the server gave it. These routes are not in the public contract yet, so a
 * field the client does not know is still one click away instead of being lost.
 */
function RawAnswer({ value }: { value: unknown }) {
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no')
  const json = JSON.stringify(value, null, 2)
  const copy = () => {
    try {
      navigator.clipboard.writeText(json).then(
        () => {
          setCopied('yes')
        },
        () => {
          setCopied('failed')
        },
      )
    } catch {
      /* no clipboard outside a secure page: the text below can still be selected by hand */
      setCopied('failed')
    }
  }
  return (
    <details>
      <summary>Сира відповідь сервера</summary>
      <p>
        <button type="button" className="btn sm" onClick={copy}>
          {copied === 'yes' ? 'скопійовано' : 'скопіювати'}
        </button>
        {copied === 'failed' && <span className="note-inline"> не вдалося скопіювати - виділіть текст нижче</span>}
      </p>
      <pre className="raw">{json}</pre>
    </details>
  )
}

/* the node's wire counters of a seat in the words of the interface (scoring 8.3 and 8.5) */
const WIRE: Readonly<Record<string, string>> = {
  missed: 'тактів без відповіді',
  unsent: 'кадрів не надіслав вузол',
  garbage: 'кадрів не за схемою',
  phantom: 'відповідей на чужий такт',
  badResume: 'кривих печаток повернення',
  dupsSent: 'дублів кадрів',
  lateResume: 'пізніх повернень',
}

/** Saves a text as a file of the browser. */
function saveText(name: string, text: string): void {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  link.download = name
  link.click()
  setTimeout(() => {
    URL.revokeObjectURL(link.href)
  }, 10_000)
}

/* the state of a game in the words of the interface; an unknown one is shown as the server names it */
const GAME_STATE: Readonly<Record<string, string>> = {
  scheduled: 'заплановано',
  running: 'іде',
  played: 'зіграно',
  cancelled: 'знято',
}

const hex = (buf: ArrayBuffer): string => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

/**
 * A record is bytes (application/octet-stream), so it is fetched past the JSON
 * client, with the session's Authorization; the sha256 from the list is checked
 * before the file is handed to the browser.
 */
function useRecordDownload(gameId: string) {
  const { session } = useAuth()
  const { api } = useServer()
  return useCallback(
    async (rec: RecordFile): Promise<string | null> => {
      if (!session?.token) return 'Немає сесії.'
      const url = api.url(`/me/games/${encodeURIComponent(gameId)}/records/${encodeURIComponent(rec.file)}`)
      let res: Response
      try {
        res = await fetch(url, { headers: { Authorization: `Bearer ${session.token}` } })
      } catch {
        return 'Немає зв’язку з сервером.'
      }
      if (!res.ok) return `Помилка ${String(res.status)}.`
      const bytes = await res.arrayBuffer()
      /* crypto.subtle lives only in a secure context: https or localhost, where the client is served */
      if (rec.sha256 && window.isSecureContext) {
        const got = hex(await crypto.subtle.digest('SHA-256', bytes))
        if (got !== rec.sha256) return `Файл прийшов пошкоджений: sha256 ${got.slice(0, 12)}… замість ${rec.sha256.slice(0, 12)}….`
      }
      const link = document.createElement('a')
      link.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }))
      link.download = rec.file
      link.click()
      setTimeout(() => {
        URL.revokeObjectURL(link.href)
      }, 10_000)
      return null
    },
    [session, api, gameId],
  )
}

function GameList() {
  const store = useCabinetStore()
  const [games, setGames] = useState<GameRow[] | null>(null)
  const [skipped, setSkipped] = useState(0)
  const [raw, setRaw] = useState<unknown>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [reading, setReading] = useState(true)
  const [round, setRound] = useState(0)

  useEffect(() => {
    if (!store) return
    let alive = true
    void store.readGames().then((result) => {
      if (!alive) return
      setReading(false)
      if (result.ok) {
        setGames(result.data.items)
        setSkipped(result.data.skipped)
        setRaw(result.data.raw)
        setProblem(null)
      } else setProblem(describeFailure(result))
    })
    return () => {
      alive = false
    }
  }, [store, round])

  const reread = () => {
    setReading(true)
    setRound((n) => n + 1)
  }

  return (
    <CabinetDoc
      here="Ігри"
      title="Ігри"
      lead="Ваші пакети: коли, проти кого, з яким результатом. Записи пакета - журнали партій і щоденник віри вашого бота - з'являються, щойно пакет закрито."
      meta={() => (
        <button type="button" className="btn sm" disabled={reading} onClick={reread}>
          <Icon name="refresh" />
          {reading ? 'читаємо…' : 'оновити'}
        </button>
      )}
    >
      {() => (
        <>
          {problem && <p className="callout err">Ігри не прочитано: {problem}</p>}
          {skipped > 0 && <p className="callout warn">Частину ігор ({skipped}) клієнт не зміг прочитати і не показує.</p>}
          {!games && !problem && <p className="note">Читаємо ігри…</p>}
          {games?.length === 0 && <p className="note">Ігор поки немає.</p>}
          {games && <RawAnswer value={raw} />}
          {games && games.length > 0 && (
            <div className="tbl">
              <table>
                <thead>
                  <tr>
                    <th>Коли</th>
                    <th>Що</th>
                    <th>Суперники</th>
                    <th>Результат</th>
                  </tr>
                </thead>
                <tbody>
                  {games.map((g) => (
                    <tr key={g.id}>
                      <td data-label="Коли" className="num">
                        <Link to={`/games/${encodeURIComponent(g.id)}`}>{g.at ? formatLocal(g.at) : 'час оголосять'}</Link>
                      </td>
                      <td data-label="Що">{g.title || g.id}</td>
                      <td data-label="Суперники">{g.opponents.join(', ') || '—'}</td>
                      <td data-label="Результат">{g.result || GAME_STATE[g.state] || g.state || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </CabinetDoc>
  )
}

function GamePack({ id }: { id: string }) {
  const store = useCabinetStore()
  const { session } = useAuth()
  const me = new Set([session?.user.username, session?.user.displayName].filter(Boolean))
  const download = useRecordDownload(id)
  const [view, setView] = useState<PackView | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [fileProblem, setFileProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!store) return
    let alive = true
    void store.readGamePack(id).then((result) => {
      if (!alive) return
      if (result.ok) setView(result.data)
      else setProblem(describeFailure(result))
    })
    return () => {
      alive = false
    }
  }, [store, id])

  const take = async (files: readonly RecordFile[]) => {
    setFileProblem(null)
    for (const rec of files) {
      setBusy(rec.file)
      const why = await download(rec)
      if (why) {
        setFileProblem(`${rec.file}: ${why}`)
        break
      }
    }
    setBusy(null)
  }

  const pack = view?.pack ?? null
  return (
    <CabinetDoc crumbs={GAMES} here="Пакет" title="Пакет" lead="Підсумок пакета і його записи: журнали партій і щоденник віри вашого бота.">
      {() => (
        <>
          {problem && <p className="callout err">Пакет не прочитано: {problem}</p>}
          {!view && !problem && <p className="note">Читаємо пакет…</p>}
          {pack && (
            <>
              <h2>Частки</h2>
              <div className="tbl">
                <table>
                  <thead>
                    <tr>
                      <th>Учасник</th>
                      <th>Частка за пакет</th>
                      {pack.rotations.map((_, i) => (
                        <th key={i}>Партія {i + 1}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pack.shares.map((share, p) => (
                      <tr key={p} className={me.has(pack.roster[p]) ? 'me' : undefined}>
                        <td data-label="Учасник">{pack.roster[p] ?? `учасник ${String(p + 1)}`}</td>
                        <td data-label="Частка за пакет" className="num">
                          {share}
                        </td>
                        {pack.rotations.map((rot, m) => {
                          const slot = rot[p] ?? ''
                          const score = pack.matches[m]?.score[slot]
                          const part = pack.shareParts[p]?.[m]
                          return (
                            <td key={m} data-label={`Партія ${String(m + 1)}`} className="num">
                              {slot}
                              {score === undefined ? '' : ` · ${score.toFixed(1)}`}
                              {part === undefined ? '' : ` · частка ${String(part)}`}
                              {pack.absent[p]?.[m] && <div className="note-inline">без присяги</div>}
                              {Object.entries(pack.wire[p]?.[m] ?? {}).map(([name, n]) => (
                                <div key={name} className="note-inline">
                                  {WIRE[name] ?? name}: {n}
                                </div>
                              ))}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="note">
                У клітинці партії: слот · очки · частка за партію, нижче - лічильники проводу, якщо вузол щось записав.
                {pack.seed !== null && ` Долина ${String(pack.seed)}.`}
                {pack.ticks !== null && ` ${String(pack.ticks)} тактів.`}
              </p>
            </>
          )}
          {view && (
            <>
              <h2>Записи</h2>
              {fileProblem && <p className="callout err">{fileProblem}</p>}
              {view.records.length === 0 ? (
                <p className="note">Записів поки немає.</p>
              ) : (
                <>
                  <div className="tbl">
                    <table>
                      <thead>
                        <tr>
                          <th>Файл</th>
                          <th>Що</th>
                          <th>Розмір</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {view.records.map((rec) => (
                          <tr key={rec.file} className={rec.mine ? 'me' : undefined}>
                            <td data-label="Файл">
                              <code>{rec.file}</code>
                            </td>
                            <td data-label="Що">{rec.kind || '—'}</td>
                            <td data-label="Розмір" className="num">
                              {rec.bytes === null ? '—' : `${(rec.bytes / 1024).toFixed(1)} КБ`}
                            </td>
                            <td>
                              <button type="button" className="btn sm" disabled={busy !== null} onClick={() => void take([rec])}>
                                {busy === rec.file ? 'завантажую…' : 'завантажити'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p>
                    <button type="button" className="btn" disabled={busy !== null} onClick={() => void take(view.records)}>
                      Завантажити все ({view.records.length})
                    </button>
                  </p>
                  {view.summary && (
                    <p>
                      <button type="button" className="btn sm" onClick={() => {
                        saveText('pack.json', JSON.stringify(view.summary, null, 2))
                      }}>
                        Зберегти pack.json
                      </button>
                    </p>
                  )}
                  <p className="note">Перевіряємо sha256 кожного файлу. Покладіть журнали й pack.json в одну теку - її відкриє штаб.</p>
                </>
              )}
              <RawAnswer value={view.raw} />
            </>
          )}
        </>
      )}
    </CabinetDoc>
  )
}

/** Part 3: one's own games and their records (part3/03-record.md 6.1). */
export function GamesPage() {
  const { id } = useParams()
  return id ? <GamePack key={id} id={id} /> : <GameList />
}
