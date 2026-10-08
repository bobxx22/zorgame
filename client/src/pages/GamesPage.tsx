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
                        <Link to={`/games/${encodeURIComponent(g.id)}`}>{formatLocal(g.at)}</Link>
                      </td>
                      <td data-label="Що">{g.title || g.id}</td>
                      <td data-label="Суперники">{g.opponents.join(', ') || '—'}</td>
                      <td data-label="Результат">{g.result || '—'}</td>
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
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="note">
                У клітинці партії: слот · очки · частка за партію.
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
                  <p className="note">Перевіряємо sha256 кожного файлу. Покладіть їх в одну теку - її відкриє штаб.</p>
                </>
              )}
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
