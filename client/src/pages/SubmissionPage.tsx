import { useEffect, useState } from 'react'
import { useCabinetStore } from '../app/cabinet-context'
import { describeFailure } from '../cabinet/store'
import { STAGE_NAMES, type Stack, type StackVerdict } from '../cabinet/submission'
import { formatLocal, formatUtc } from '../lib/time'
import { Icon } from '../ui/Icon'
import { CabinetDoc } from './CabinetDoc'

const PHASE: Readonly<Record<string, string>> = {
  ahead: 'до фіксації',
  retry: 'триває перездача',
  past: 'вікно минуло',
}

const SUBMISSION_STATE: Readonly<Record<string, string>> = {
  queued: 'у черзі',
  running: 'прогін іде',
  ok: 'прийнято',
  failed: 'провалено',
}

function VerdictTable({ verdict }: { verdict: StackVerdict }) {
  return (
    <div className="tbl">
      <table>
        <thead>
          <tr>
            <th>Ступінь</th>
            <th>Результат</th>
            <th>Подробиці</th>
          </tr>
        </thead>
        <tbody>
          {verdict.checks.map((c) => (
            <tr key={c.name}>
              <td data-label="Ступінь">
                {STAGE_NAMES[c.name] ?? c.name}
                <div className="note-inline">{c.name}</div>
              </td>
              <td data-label="Результат">
                <span className={`chip ${c.ok ? 'ok' : 'err'}`}>{c.ok ? 'так' : 'ні'}</span>
              </td>
              <td data-label="Подробиці">{c.detail || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function VerdictHead({ verdict }: { verdict: StackVerdict }) {
  return (
    <p className={`callout ${verdict.ok ? 'ok' : 'err'}`}>
      {verdict.ok ? 'Вердикт зелений: коміт прийнято.' : 'Вердикт червоний: коміт не прийнято.'} Коміт <code>{verdict.sha.slice(0, 12) || '—'}</code>
      {verdict.digest && (
        <>
          , замок стека <code>{verdict.digest.slice(0, 19)}</code>
        </>
      )}
      {verdict.at && <>, {formatLocal(verdict.at)}</>}.
    </p>
  )
}

/**
 * Part 4, the submission: the window, the last verdict of the preflight run with
 * its eleven stages, the history. Read-only: a resubmission is asked for elsewhere
 * on purpose - it can be spent once per window.
 */
export function SubmissionPage() {
  const store = useCabinetStore()
  const [stack, setStack] = useState<Stack | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [reading, setReading] = useState(true)
  const [round, setRound] = useState(0)

  useEffect(() => {
    if (!store) return
    let alive = true
    void store.readStack().then((result) => {
      if (!alive) return
      setReading(false)
      if (result.ok) {
        setStack(result.data)
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
      here="Здача"
      title="Здача"
      lead="Коміт, який мережа зафіксувала у вікні, і вердикт передстартового прогону: ті самі одинадцять ступенів, що npx zaria-kit preflight."
      meta={() => (
        <button type="button" className="btn sm" disabled={reading} onClick={reread}>
          <Icon name="refresh" />
          {reading ? 'читаємо…' : 'оновити'}
        </button>
      )}
    >
      {() => (
        <>
          {problem && <p className="callout err">Стан здачі не прочитано: {problem}</p>}
          {!stack && !problem && <p className="note">Читаємо стан здачі…</p>}
          {stack && (
            <>
              {stack.window && (
                <div className="tbl c2">
                  <table>
                    <tbody>
                      <tr>
                        <td>Вікно</td>
                        <td>
                          {stack.window.title || stack.window.id} · {PHASE[stack.window.phase] ?? stack.window.phase}
                        </td>
                      </tr>
                      {stack.window.freezeAt && (
                        <tr>
                          <td>Фіксація коміту</td>
                          <td>
                            {formatLocal(stack.window.freezeAt)} <span className="note-inline">({formatUtc(stack.window.freezeAt)})</span>
                          </td>
                        </tr>
                      )}
                      {stack.window.retryUntil && (
                        <tr>
                          <td>Перездача до</td>
                          <td>{formatLocal(stack.window.retryUntil)}</td>
                        </tr>
                      )}
                      {stack.retry && (
                        <tr>
                          <td>Перездача</td>
                          <td>
                            {stack.retry.used
                              ? 'витрачена'
                              : stack.retry.available
                                ? 'доступна'
                                : stack.window.phase === 'ahead'
                                  ? 'відкриється після фіксації'
                                  : 'немає'}
                          </td>
                        </tr>
                      )}
                      {stack.nextGameAt && (
                        <tr>
                          <td>Наступна гра</td>
                          <td>{formatLocal(stack.nextGameAt)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
              {stack.submissions.length > 0 && (
                <>
                  <h2>Здачі цього вікна</h2>
                  <div className="tbl">
                    <table>
                      <thead>
                        <tr>
                          <th>Як</th>
                          <th>Коли</th>
                          <th>Коміт</th>
                          <th>Стан</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stack.submissions.map((s, i) => (
                          <tr key={i}>
                            <td data-label="Як">{s.kind === 'retry' ? (s.auto ? 'перездача (взята мережею)' : 'перездача') : 'вікно'}</td>
                            <td data-label="Коли" className="num">
                              {formatLocal(s.requestedAt)}
                            </td>
                            <td data-label="Коміт">
                              <code>{s.sha?.slice(0, 12) ?? '—'}</code>
                            </td>
                            <td data-label="Стан">{SUBMISSION_STATE[s.state] ?? s.state}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              <h2>Останній вердикт</h2>
              {stack.latest ? (
                <>
                  <VerdictHead verdict={stack.latest} />
                  <VerdictTable verdict={stack.latest} />
                </>
              ) : (
                <p className="note">Вердиктів ще немає: прогін іде після фіксації коміту.</p>
              )}
              {stack.history.length > 1 && (
                <>
                  <h2>Попередні вердикти</h2>
                  {stack.history.slice(1).map((v) => (
                    <details key={v.id || v.at || v.sha}>
                      <summary>
                        <span className={`chip ${v.ok ? 'ok' : 'err'}`}>{v.ok ? 'зелений' : 'червоний'}</span> {formatLocal(v.at)} · <code>{v.sha.slice(0, 12)}</code>
                      </summary>
                      <VerdictTable verdict={v} />
                    </details>
                  ))}
                </>
              )}
            </>
          )}
        </>
      )}
    </CabinetDoc>
  )
}
