import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useCabinet, useCabinetStore } from '../app/cabinet-context'
import { bridgeRows } from '../cabinet/bridge'
import type { Stage, StageSummary } from '../cabinet/schemas'
import { PART_PLAN } from '../config/season'
import { cls } from '../lib/cls'
import { formatDay, formatDayTime, formatLocal } from '../lib/time'
import { Icon } from '../ui/Icon'
import { CabinetDoc } from './CabinetDoc'
import { Markdown } from './Markdown'

/** Parts of the task released to this account, on the site's indicator bridge (CL-31). */
export function StagesPage() {
  return (
    <CabinetDoc
      here="Завдання"
      title="Частини завдання"
      wide
      lead="Частини видаються в кабінеті кожна у свій строк і приходять разом із листом. Відкриття тексту отримання не підтверджує: для цього є кнопка в самій частині."
      meta={(cabinet) =>
        cabinet.stages ? (
          <>
            <span>
              <Icon name="parts" />
              видано: {cabinet.stages.length}
            </span>
            <span>
              <Icon name="check" />
              не підтверджено: {cabinet.stages.filter((s) => s.acknowledgedAt === null).length}
            </span>
          </>
        ) : null
      }
    >
      {(cabinet) =>
        cabinet.stages === null ? (
          <p className="note">Читаємо список частин…</p>
        ) : (
          <>
            <Bridge stages={cabinet.stages} />
            <p className="order">
              Нова частина з'явиться тут сама: прийде лист і пролунає сигнал станції. Частина 2 - 28.09, частини 3 і 4 -
              05.10.
            </p>
          </>
        )
      }
    </CabinetDoc>
  )
}

function Bridge({ stages }: { stages: readonly StageSummary[] }) {
  return (
    <ol className="bridge">
      {bridgeRows(stages, PART_PLAN).map((row) => {
        if (row.kind === 'stage') {
          const { stage } = row
          const acked = stage.acknowledgedAt !== null
          return (
            <li key={`s-${stage.id}`} className={cls('mod', 'out', !acked && 'live')}>
              <Link to={`/stages/${encodeURIComponent(stage.id)}`}>
                <div className="w">
                  <span className="dt num">видано {formatDay(stage.releasedAt)}</span>
                  <b>{stage.title}</b>
                  <p>{stage.excerpt}</p>
                  {stage.errataAt && <span className="er">уточнення від {formatDay(stage.errataAt)}</span>}
                </div>
                <div className="pl">
                  <span className="pnum">{stage.position}</span>
                  <span className="st">
                    <i className="lamp" />
                    {acked ? 'отримано' : 'підтвердіть'}
                  </span>
                </div>
              </Link>
            </li>
          )
        }
        const { plan } = row
        return (
          <li key={`p-${String(plan.position)}`} className="mod">
            <div>
              <div className="w">
                <span className="dt num">очікується {plan.day}</span>
                <b>{plan.title}</b>
                <p>Відкриється в кабінеті у свій строк.</p>
              </div>
              <div className="pl">
                <span className="pnum">{plan.position}</span>
                <span className="st">
                  <i className="lamp" />
                  ще не видано
                </span>
              </div>
            </div>
          </li>
        )
      })}
    </ol>
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
  const [attempt, setAttempt] = useState(0)
  const stage = cabinet?.stageBodies[id]
  // A letter or a part that moved the summary may be this very part: a failed or missing one is asked again.
  const released = cabinet?.summary?.releasedStages ?? null
  const unread = cabinet?.summary?.unread ?? null

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
  }, [store, id, cabinet?.noise, attempt, released, unread])

  const retry = () => {
    setLoad({ state: 'loading' })
    setAttempt((n) => n + 1)
  }

  const acknowledge = () => {
    if (!store || !stage) return
    setAcking(true)
    void store.acknowledge(stage.id).finally(() => {
      setAcking(false)
    })
  }

  return (
    <CabinetDoc
      crumbs={[
        { to: '/', label: 'Ефір' },
        { to: '/stages', label: 'Частини завдання' },
      ]}
      here={stage ? `Частина ${String(stage.position)}` : 'Частина'}
      title={stage?.title ?? 'Частина завдання'}
      meta={() =>
        stage ? (
          <>
            <span>
              <Icon name="calendar" />
              видано {formatDayTime(stage.releasedAt)}
            </span>
            <span className={cls('pill', stage.acknowledgedAt ? 'ok' : 'warn')}>
              <i className="lamp" />
              {stage.acknowledgedAt ? 'отримання підтверджено' : 'отримання не підтверджено'}
            </span>
            {stage.errataAt && (
              <span className="pill warn">
                <Icon name="doc" />є уточнення
              </span>
            )}
          </>
        ) : null
      }
      toc={() => (stage ? <StageSide stage={stage} acking={acking} onAck={acknowledge} /> : null)}
    >
      {() => (
        <>
          {!stage && load.state === 'loading' && <p className="note">Читаємо частину…</p>}
          {!stage && (load.state === 'missing' || load.state === 'failed') && (
            <>
              {load.state === 'missing' ? (
                <p className="callout warn">
                  Такої частини немає або її ще не видано. Клієнт спитає знову, щойно прийде лист або нова частина.
                </p>
              ) : (
                <p className="callout err">Не вдалося прочитати частину.</p>
              )}
              <div className="acts">
                <button type="button" className="btn sm" onClick={retry}>
                  <Icon name="refresh" />
                  Спробувати ще
                </button>
              </div>
            </>
          )}
          {stage && (
            <>
              <div className="side-inline">
                <StageSide stage={stage} acking={acking} onAck={acknowledge} />
              </div>
              <Markdown source={stage.body} />
            </>
          )}
        </>
      )}
    </CabinetDoc>
  )
}

/** Receipt and errata: in the right rail on wide screens, above the text on narrow ones. */
function StageSide({ stage, acking, onAck }: { stage: Stage; acking: boolean; onAck: () => void }) {
  return (
    <>
      <div className="sidebox">
        <p className="rh">Отримання</p>
        {stage.acknowledgedAt ? (
          <p className="side-ok">
            <Icon name="check" />
            Підтверджено {formatLocal(stage.acknowledgedAt)}.
          </p>
        ) : (
          <>
            <p>Відкриття тексту отримання не підтверджує.</p>
            <button type="button" className="btn pri sm" disabled={acking} onClick={onAck}>
              <Icon name="check" />
              Підтвердити отримання
            </button>
          </>
        )}
      </div>
      {stage.errata && (
        <div className="sidebox errata">
          <p className="rh">
            Уточнення
            {stage.errataAt && <span className="num"> · {formatDayTime(stage.errataAt)}</span>}
          </p>
          <Markdown source={stage.errata} />
        </div>
      )}
    </>
  )
}
