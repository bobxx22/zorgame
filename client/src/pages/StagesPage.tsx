import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useCabinet, useCabinetStore } from '../app/cabinet-context'
import { formatLocal } from '../lib/time'
import { CabinetScreen } from './CabinetState'
import { Markdown } from './Markdown'

/** Parts of the task released to this account (CL-31). */
export function StagesPage() {
  return (
    <CabinetScreen title="Частини завдання">
      {(cabinet) =>
        cabinet.stages === null ? (
          <p className="muted">Читаємо список частин…</p>
        ) : cabinet.stages.length === 0 ? (
          <p className="muted">Частин ще не видано. Частина 2 виходить 28.09 і з'явиться тут сама.</p>
        ) : (
          <div className="list">
            {cabinet.stages.map((stage) => (
              <Link key={stage.id} to={`/stages/${encodeURIComponent(stage.id)}`} className="panel stage-item">
                <div className="screen-head">
                  <h2>
                    <span className="muted mono">{stage.position}.</span> {stage.title}
                  </h2>
                  <span className="muted small mono">видано {formatLocal(stage.releasedAt)}</span>
                </div>
                <p className="muted">{stage.excerpt}</p>
                <div className="row small">
                  {stage.acknowledgedAt ? (
                    <span className="ok-text">отримання підтверджено</span>
                  ) : (
                    <span className="warn-text">отримання не підтверджено</span>
                  )}
                  {stage.errataAt && <span className="warn-text">є уточнення від {formatLocal(stage.errataAt)}</span>}
                </div>
              </Link>
            ))}
          </div>
        )
      }
    </CabinetScreen>
  )
}

type Load = { state: 'loading' } | { state: 'missing' } | { state: 'failed' } | { state: 'ready' }

/** Full text, the errata beside it and apart from it, explicit receipt (CL-31 - CL-33). */
export function StagePage() {
  const { id = '' } = useParams()
  const store = useCabinetStore()
  const cabinet = useCabinet()
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [acking, setAcking] = useState(false)
  const stage = cabinet?.stageBodies[id]

  useEffect(() => {
    if (!store || cabinet?.noise) return
    let active = true
    void store.openStage(id).then((result) => {
      if (!active) return
      setLoad(result === 'missing' ? { state: 'missing' } : result === null ? { state: 'failed' } : { state: 'ready' })
    })
    return () => {
      active = false
    }
  }, [store, id, cabinet?.noise])

  return (
    <CabinetScreen title="Частина завдання">
      {() => (
        <>
          <p>
            <Link to="/stages">← усі частини</Link>
          </p>
          {!stage && load.state === 'loading' && <p className="muted">Читаємо частину…</p>}
          {load.state === 'missing' && <p className="warn-text">Такої частини немає або її ще не видано.</p>}
          {!stage && load.state === 'failed' && <p className="err-text">Не вдалося прочитати частину.</p>}
          {stage && (
            <div className="stage-layout">
              <article className="panel stage-text">
                <div className="screen-head">
                  <h2>
                    <span className="muted mono">{stage.position}.</span> {stage.title}
                  </h2>
                  <span className="muted small mono">видано {formatLocal(stage.releasedAt)}</span>
                </div>
                <Markdown source={stage.body} />
              </article>
              <aside className="stage-side">
                {stage.errata && (
                  <section className="panel errata">
                    <h3>Уточнення</h3>
                    {stage.errataAt && <p className="muted small mono">{formatLocal(stage.errataAt)}</p>}
                    <Markdown source={stage.errata} />
                  </section>
                )}
                <section className="panel">
                  {stage.acknowledgedAt ? (
                    <p className="ok-text small">Отримання підтверджено {formatLocal(stage.acknowledgedAt)}.</p>
                  ) : (
                    <>
                      <p className="small muted">Відкриття тексту отримання не підтверджує.</p>
                      <button
                        type="button"
                        className="primary"
                        disabled={acking}
                        onClick={() => {
                          if (!store) return
                          setAcking(true)
                          void store.acknowledge(stage.id).finally(() => {
                            setAcking(false)
                          })
                        }}
                      >
                        Підтвердити отримання
                      </button>
                    </>
                  )}
                </section>
              </aside>
            </div>
          )}
        </>
      )}
    </CabinetScreen>
  )
}
