import { Link } from 'react-router'
import { useEther, useEtherListener } from '../app/ether-context'
import { useServer } from '../app/server-context'
import { SEASON } from '../config/season'
import type { EtherSnapshot } from '../ether/listener'
import { letter, serverNow } from '../ether/station'
import { formatDuration, formatLocal, formatLocalTime, zoneLabel } from '../lib/time'
import { useNow } from '../lib/use-now'
import { KEY_PROBLEM, OUTCOME, PHASE_LABEL } from './ether-labels'

export function EtherPage() {
  const ether = useEther()
  return (
    <div className="grid">
      <PhasePanel ether={ether} />
      <ListenPanel ether={ether} />
      <KeyPanel ether={ether} />
      <LetterPanel ether={ether} />
      <LogPanel ether={ether} />
    </div>
  )
}

function PhasePanel({ ether }: { ether: EtherSnapshot }) {
  const { server } = useServer()
  const now = useNow()
  const { station } = ether
  const srvNow = serverNow(station, now)
  const zone = zoneLabel()

  return (
    <section className="panel span-2">
      <div className="phase-head">
        <span className={`phase phase-${station.phase ?? 'unknown'}`}>
          {station.phase ? PHASE_LABEL[station.phase] : 'Невідомо'}
        </span>
        {station.latest && (
          <span className="muted">
            останній сигнал о {formatLocalTime(station.latest.atMs)} · у журналі: {station.onAir ?? '—'}
          </span>
        )}
      </div>

      {station.phase === null && (
        <p>
          Чекаємо на справжній кадр із печаткою станції. Відповідям без печатки клієнт не вірить.
        </p>
      )}

      {station.phase === 'static' && station.opensAtMs !== null && (
        <div className="countdown">
          <div className="muted">Провісник: просвіт відкриється через</div>
          <div className="countdown-value mono">{formatDuration(station.opensAtMs - srvNow)}</div>
          <div>
            о <b className="mono">{formatLocal(station.opensAtMs)}</b> <span className="muted">{zone}</span>
          </div>
          {station.harbingerText && <blockquote className="voice">{station.harbingerText.uk}</blockquote>}
          {station.opensAtMs <= srvNow && (
            <p className="warn-text">Час відкриття настав. Чекаємо на кадр просвіту.</p>
          )}
        </div>
      )}

      {station.phase === 'static' && station.opensAtMs === null && (
        <p>
          Провісника немає: найближчі 6 годин просвіту не буде.
          {server.id === 'prod' && (
            <>
              {' '}
              Початок просвіту - між <b className="mono">{formatLocal(SEASON.windowEarliest)}</b> і{' '}
              <b className="mono">{formatLocal(SEASON.windowLatest)}</b> <span className="muted">{zone}</span>.
            </>
          )}
        </p>
      )}

      {station.phase === 'window' && station.window && (
        <div className="countdown">
          <div className="ok-text">Просвіт відкрито. Реєстрація працює.</div>
          <div className="countdown-value mono">{formatDuration(station.window.closesAtMs - srvNow)}</div>
          <div>
            до кінця, закриття о <b className="mono">{formatLocal(station.window.closesAtMs)}</b>{' '}
            <span className="muted">{zone}</span>
          </div>
          <p>
            <Link to="/register">Перейти до реєстрації</Link>
          </p>
        </div>
      )}

      {station.phase === 'after' && (
        <p>
          Просвіт завершено
          {station.window && (
            <>
              {' '}
              о <b className="mono">{formatLocal(station.window.closesAtMs)}</b>
            </>
          )}
          . Реєстрацію закрито.
        </p>
      )}

      {station.clockOffsetMs !== null && Math.abs(station.clockOffsetMs) >= 2_000 && (
        <p className="muted small">
          Годинник пристрою {station.clockOffsetMs > 0 ? 'відстає від' : 'поспішає відносно'} сервера на{' '}
          {Math.round(Math.abs(station.clockOffsetMs) / 1000)} с; відлік іде за сервером.
        </p>
      )}
    </section>
  )
}

function ListenPanel({ ether }: { ether: EtherSnapshot }) {
  const listener = useEtherListener()
  const now = useNow()
  const count = (outcome: keyof typeof OUTCOME) => ether.counts[outcome] ?? 0
  const noise =
    count('forged') + count('broken') + count('no-envelope') + count('unknown-key') + count('malformed-frame')

  return (
    <section className="panel">
      <h2>Прослуховування</h2>
      <div className="row">
        <button
          type="button"
          onClick={() => {
            if (ether.listening) listener.stop()
            else listener.start()
          }}
        >
          {ether.listening ? 'Пауза' : 'Слухати'}
        </button>
        <span className="muted">
          {ether.listening && ether.nextPollAtMs !== null
            ? `наступний запит через ${String(Math.max(0, Math.ceil((ether.nextPollAtMs - now) / 1000)))} с`
            : ether.listening
              ? 'запит…'
              : 'на паузі'}
        </span>
      </div>
      <dl className="stats mono">
        <dt>сигнали</dt>
        <dd className="ok-text">{count('signal')}</dd>
        <dt>ехо</dt>
        <dd>{count('echo')}</dd>
        <dt>перешкоди</dt>
        <dd className="warn-text">{noise}</dd>
        <dt>збої</dt>
        <dd className="err-text">{count('network') + count('timeout')}</dd>
        <dt>глушіння</dt>
        <dd className="err-text">{count('jammed') + count('rate-limited')}</dd>
      </dl>
      {ether.failureStreak > 0 && (
        <p className="muted small">Збоїв поспіль: {ether.failureStreak}. Пауза між запитами зростає.</p>
      )}
    </section>
  )
}

function KeyPanel({ ether }: { ether: EtherSnapshot }) {
  const { key, keyProblem } = ether
  return (
    <section className="panel">
      <h2>Печатка станції</h2>
      {key ? (
        <>
          <div className="muted small">id ключа</div>
          <div className="mono">{key.id}</div>
          <div className="muted small">відбиток SHA-256</div>
          <div className="mono fingerprint">{key.fingerprint.match(/.{1,8}/g)?.join(' ')}</div>
          {key.pinned ? (
            <p className="ok-text small">Збігається з відбитком із ТЗ.</p>
          ) : (
            <p className="warn-text small">
              Відбиток у ТЗ ще не опубліковано. Звірте його вручну, коли з'явиться.
            </p>
          )}
          {key.changed && (
            <p className="err-text small">Ключ змінився відносно збереженого. Перевірте новини й уточнення до ТЗ.</p>
          )}
        </>
      ) : (
        <p className="muted">Ключ ще не отримано.</p>
      )}
      {keyProblem && <p className="err-text small">{KEY_PROBLEM[keyProblem]}</p>}
    </section>
  )
}

function LetterPanel({ ether }: { ether: EtherSnapshot }) {
  const parts = letter(ether.station)
  const got = parts.filter((p) => p !== null).length
  return (
    <section className="panel span-2">
      <h2>
        Лист Доглядача{' '}
        {parts.length > 0 && (
          <span className="muted mono">
            {got}/{parts.length}
          </span>
        )}
      </h2>
      {parts.length === 0 ? (
        <p className="muted">Уривків ще не було. Вони приходять у справжніх кадрах до просвіту.</p>
      ) : (
        <ol className="letter">
          {parts.map((part, i) => (
            <li key={i} className={part === null ? 'muted' : ''}>
              {part ?? '…'}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function LogPanel({ ether }: { ether: EtherSnapshot }) {
  return (
    <section className="panel span-2">
      <h2>Журнал прийому</h2>
      {ether.log.length === 0 ? (
        <p className="muted">Поки порожньо.</p>
      ) : (
        <div className="log mono">
          {ether.log.map((entry) => {
            const outcome = OUTCOME[entry.outcome]
            return (
              <div key={entry.id} className="log-row">
                <span className="muted">{formatLocalTime(entry.atMs)}</span>
                <span className="muted">{entry.route}</span>
                <span className={`${outcome.tone}-text`}>{outcome.label}</span>
                <span className="muted">{entry.status ?? ''}</span>
                <span className="muted">{entry.detail ?? ''}</span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
