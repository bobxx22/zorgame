import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../app/auth-context'
import { useCabinet } from '../app/cabinet-context'
import { useEther, useEtherListener } from '../app/ether-context'
import { useRegistration } from '../app/registration-context'
import { useServer } from '../app/server-context'
import { SEASON } from '../config/season'
import { voiceOf } from '../ether/frame'
import type { EtherSnapshot } from '../ether/listener'
import { letter, serverNow } from '../ether/station'
import { cls } from '../lib/cls'
import { formatDay, formatDayTime, formatDuration, formatLocalTime, zoneLabel } from '../lib/time'
import { useNow } from '../lib/use-now'
import { CopyButton } from '../ui/CopyButton'
import { Icon, type IconName } from '../ui/Icon'
import { useNavCounts } from '../ui/nav'
import { Scene } from '../ui/Scene'
import { SeasonLine } from '../ui/SeasonLine'
import { accessStatusOf } from './auth-labels'
import { KEY_PROBLEM, LOOK_SCENE, OUTCOME, lookOf, type Look } from './ether-labels'

/**
 * The home screen, laid out as the site's home: the station's scene with the
 * current state over it, the facts and the countdown island at its foot, then
 * the Keeper's letter and the cabinet, the reception log and the season.
 */
export function EtherPage() {
  const ether = useEther()
  const now = useNow()
  const srvNow = serverNow(ether.station, now)

  return (
    <>
      <Hero ether={ether} srvNow={srvNow} now={now} />
      <section className="home-sec wrap">
        <div className="p1grid">
          <KeeperLetter ether={ether} />
          <CabinetCards ether={ether} />
        </div>
      </section>
      <ReceptionLog ether={ether} />
      <section className="season wrap" aria-label="Сезон">
        <div className="sh">
          <h2>Сезон</h2>
          <span className="meta">21.09 - 21.10</span>
        </div>
        <SeasonLine nowMs={srvNow} />
        <p className="tl-note">Дати можуть зсунутися тільки вперед, за правилом зсуву; зсув оголошують новиною.</p>
      </section>
    </>
  )
}

interface HeroCopy {
  kick: string
  h1: string
  lead: ReactNode
  rule: ReactNode
}

function Hero({ ether, srvNow, now }: { ether: EtherSnapshot; srvNow: number; now: number }) {
  const listener = useEtherListener()
  const { server } = useServer()
  const { session } = useAuth()
  const { station, listening, nextPollAtMs } = ether
  const look = lookOf(station)
  const lastSignal = station.latest ? `останній сигнал о ${formatLocalTime(station.latest.atMs)}` : 'кадрів із печаткою ще не було'
  const voice = look === 'harbinger' && station.harbingerText ? voiceOf(station.harbingerText) : null
  const onAir = station.onAir
  // The harbinger comes 6 h ahead on the live server, 10 min ahead on the stand (client spec, section 6).
  const ahead = server.id === 'prod' ? 'шість годин' : 'десять хвилин'
  const asOf = station.latest ? `Станом на ${formatLocalTime(station.latest.atMs)}` : 'Поки що'

  const copy: Record<Look, HeroCopy> = {
    unknown: {
      kick: 'Ефір',
      h1: 'Слухаємо',
      lead: 'Клієнт чекає на перший кадр із печаткою станції. Відповідям без печатки він не вірить.',
      rule: 'Ефір опитується не частіше ніж раз на 15 секунд; збої розтягують паузу.',
    },
    static: {
      kick: 'Ефір · шум',
      h1: 'Шум',
      lead: `${asOf} провісника в ефірі немає: найближчі ${ahead} просвіту не буде.`,
      rule: 'Реєстрація відкривається тільки в просвіт. Заявку можна заготувати заздалегідь - клієнт надішле її сам.',
    },
    harbinger: {
      kick: 'Провісник',
      h1: 'Провісник',
      lead: 'У шумі з’явилася несуча: станція відлічує час до просвіту.',
      rule: 'Заготуйте заявку зараз - клієнт надішле її за першим перевіреним кадром просвіту, якщо вкладку не закрито.',
    },
    window: {
      kick: 'Просвіт відкрито',
      h1: 'Просвіт',
      lead: session
        ? 'Канал відкрито, і ви вже в журналі мережі. Далі - доступ до репозиторію.'
        : 'Канал відкрито, реєстрація працює. Вийдіть на зв’язок, поки просвіт не закрився.',
      rule: onAir !== null ? `У журналі виходу на зв’язок уже ${String(onAir)}.` : 'Хто не зареєструвався в просвіт, вибуває.',
    },
    after: session
      ? {
          kick: 'Після просвіту',
          h1: 'На зв’язку',
          lead: 'Просвіт минув, ви в журналі мережі. Далі - доступ до репозиторію, листи й частини завдання.',
          rule: 'Частина 2 виходить 28.09 і з’явиться в кабінеті сама, разом із листом.',
        }
      : {
          kick: 'Після просвіту',
          h1: 'Просвіт минув',
          lead: 'Реєстрацію закрито. Якщо ви вийшли на зв’язок, увійдіть: кабінет працює й далі.',
          rule: onAir !== null ? `У журналі виходу на зв’язок - ${String(onAir)}.` : 'Журнал виходу публічний.',
        },
  }
  const text = copy[look]

  const primary: { to: string; label: string; icon: IconName; state?: { mode: 'login' } } = session
    ? { to: '/contact', label: 'Заявка і доступ', icon: 'repo' }
    : look === 'after'
      ? { to: '/contact', label: 'Увійти', icon: 'user', state: { mode: 'login' } }
      : look === 'window'
        ? { to: '/contact', label: 'Вийти на зв’язок', icon: 'mast' }
        : { to: '/contact', label: 'Заготувати заявку', icon: 'doc' }

  const nextPoll =
    listening && nextPollAtMs !== null
      ? `запит через ${String(Math.max(0, Math.ceil((nextPollAtMs - now) / 1000)))} с`
      : listening
        ? 'запит…'
        : 'на паузі'

  return (
    <section className={`hero look-${look}`}>
      <Scene name={LOOK_SCENE[look]} />
      <div className="wrap hero-in">
        <div className="copy">
          <p className="kick">
            <i />
            {text.kick}
            <span className="kd num">
              {lastSignal}
              {server.id === 'stand' ? ' · навчальний стенд' : server.id === 'custom' ? ' · локальний сервер' : ''}
            </span>
          </p>
          <h1>{text.h1}</h1>
          <p className="lead">{text.lead}</p>
          {voice && <blockquote className="voice">{voice}</blockquote>}
          <p className="rule">{text.rule}</p>
          <div className="acts">
            <Link className="btn pri" to={primary.to} state={primary.state}>
              <Icon name={primary.icon} />
              {primary.label}
            </Link>
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (listening) listener.stop()
                else listener.start()
              }}
            >
              <Icon name={listening ? 'pause' : 'play'} />
              {listening ? 'Пауза' : 'Слухати'} <span className="dim num">{nextPoll}</span>
            </button>
          </div>
        </div>
        <div className="hero-low">
          <Facts ether={ether} now={now} />
          <Island ether={ether} look={look} srvNow={srvNow} />
        </div>
      </div>
    </section>
  )
}

function Facts({ ether, now }: { ether: EtherSnapshot; now: number }) {
  const { key, keyProblem, counts, listening, failureStreak, station } = ether
  const count = (outcome: keyof typeof OUTCOME) => counts[outcome] ?? 0
  const noise =
    count('forged') + count('broken') + count('no-envelope') + count('unknown-key') + count('malformed-frame')
  const offset = station.clockOffsetMs

  return (
    <div className="facts">
      <p>
        <b>Печатка станції</b>
        {key ? (
          <>
            Ed25519, ключ <code>{key.id}</code>{' '}
            <span className="fp" title={key.fingerprint}>
              <code>{key.fingerprint.slice(0, 16)}…</code>
              <CopyButton text={key.fingerprint} />
            </span>
            <span className={cls('fl', key.pinned ? 'ok' : 'warn')}>
              {key.pinned
                ? 'Відбиток збігається з опублікованим у ТЗ.'
                : 'Для цього сервера відбиток не задано: ключ прийнято за першим знайомством.'}
            </span>
            {key.changed && <span className="fl err">Ключ змінився відносно збереженого. Перевірте новини.</span>}
          </>
        ) : (
          <span>{keyProblem ? KEY_PROBLEM[keyProblem] : 'Ключ ще не отримано.'}</span>
        )}
        {key && keyProblem && <span className="fl err">{KEY_PROBLEM[keyProblem]}</span>}
      </p>
      <p>
        <b>Прийом</b>
        <span className="num">
          сигнали {count('signal')} · ехо {count('echo')} · перешкоди {noise} · глушіння{' '}
          {count('jammed') + count('rate-limited')} · обриви {count('network') + count('timeout')}
        </span>
        <span className="fl">
          {!listening
            ? 'Прослуховування на паузі.'
            : failureStreak > 0
              ? `Збоїв поспіль: ${String(failureStreak)}. Пауза між запитами зростає.`
              : 'Не частіше ніж раз на 15 секунд.'}
        </span>
      </p>
      <p>
        <b>Годинник</b>
        <span className="num">
          {formatLocalTime(now)} · {zoneLabel()}
        </span>
        <span className="fl">
          {offset === null || Math.abs(offset) < 2_000
            ? 'Відлік іде за годинником сервера.'
            : `Ваш годинник ${offset > 0 ? 'відстає' : 'поспішає'} на ${String(Math.round(Math.abs(offset) / 1000))} с; відлік іде за сервером.`}
        </span>
      </p>
    </div>
  )
}

/** The site's "Коли просвіт" island: the one number that matters now. */
function Island({ ether, look, srvNow }: { ether: EtherSnapshot; look: Look; srvNow: number }) {
  const { server } = useServer()
  const { session } = useAuth()
  const { status } = useRegistration()
  const cabinet = useCabinet()
  const { station } = ether
  const zone = zoneLabel()
  const armed = status.state === 'armed'

  let lab: string
  let tab: ReactNode
  let body: ReactNode
  let out: ReactNode
  let zoned = false

  if (look === 'harbinger' && station.opensAtMs !== null) {
    const due = station.opensAtMs <= srvNow
    lab = 'До просвіту'
    tab = formatDuration(station.opensAtMs - srvNow)
    body = due ? (
      'Час відкриття настав. Чекаємо на перший кадр просвіту.'
    ) : (
      <>
        Відкриття о <span className="num">{formatDayTime(station.opensAtMs)}</span> ({zone}).
      </>
    )
    out = session ? 'Ви вже на зв’язку.' : armed ? 'Заявку заготовлено: клієнт надішле її сам. Не закривайте вкладку.' : 'Заявку ще не заготовлено.'
  } else if (look === 'window' && station.window) {
    lab = 'До закриття просвіту'
    tab = formatDuration(station.window.closesAtMs - srvNow)
    body = (
      <>
        Закриття о <span className="num">{formatDayTime(station.window.closesAtMs)}</span> ({zone}).
      </>
    )
    out = session ? 'Ви в журналі мережі.' : 'Хто не зареєструвався в просвіт, вибуває.'
  } else if (look === 'after') {
    const repository = cabinet?.repository
    const access = repository ? accessStatusOf(repository.accessStatus) : undefined
    lab = 'Строк доступу'
    tab = formatDayTime(SEASON.accessDeadline)
    zoned = true
    body = 'До цього часу статус репозиторію має стати «підтверджено».'
    out = !session
      ? 'Статус видно після входу.'
      : repository
        ? `Зараз: ${access?.label ?? repository.accessStatus}.`
        : repository === null
          ? 'Заявки на репозиторій немає.'
          : 'Читаємо статус…'
  } else if (server.id === 'prod') {
    lab = 'Коли просвіт'
    tab = `${formatDay(SEASON.windowEarliest)} - ${formatDay(SEASON.windowLatest)}`
    zoned = true
    body = (
      <>
        почнеться між <span className="num">{formatDayTime(SEASON.windowEarliest)}</span> і{' '}
        <span className="num">{formatDayTime(SEASON.windowLatest)}</span> і триватиме щонайменше 10 годин.
      </>
    )
    out = armed ? 'Заявку заготовлено: клієнт надішле її сам.' : 'Хто не зареєструвався в просвіт, вибуває.'
  } else {
    lab = 'Коли просвіт'
    tab = server.id === 'stand' ? 'щогодини' : 'за розкладом'
    body =
      server.id === 'stand'
        ? 'Стенд ходить колом за UTC: :00-:30 шум (провісник з :20, за 10 хвилин), :30-:50 просвіт, :50-:00 після просвіту.'
        : 'Локальний сервер відкриває просвіт за своїм розкладом; провісник приходить у кадрах перед відкриттям.'
    out = armed ? 'Заявку заготовлено: клієнт надішле її сам.' : 'Реєстрація на стенді навчальна і на залік не впливає.'
  }

  return (
    <aside className={`island look-${look}`} aria-label={lab}>
      <p className="lab">
        <Icon name="clock" />
        {lab}
      </p>
      <p className={cls('tab num', typeof tab === 'string' && /^\D/.test(tab) && 'txt')}>
        {tab}
        {zoned && <small>{zone.split(' ')[0]}</small>}
      </p>
      <p>{body}</p>
      <p className="out">{out}</p>
    </aside>
  )
}

function KeeperLetter({ ether }: { ether: EtherSnapshot }) {
  const parts = letter(ether.station)
  const got = parts.filter((part) => part !== null).length
  return (
    <div>
      <div className="sh">
        <h2>Лист Доглядача</h2>
        <span className="meta">{parts.length > 0 ? `${String(got)} з ${String(parts.length)} уривків` : 'уривків ще не було'}</span>
      </div>
      <ul className="short">
        {parts.length === 0 ? (
          <li>
            <span className="t">Уривки</span>
            <span className="d">
              Приходять у справжніх кадрах до просвіту, по одному. Клієнт складає лист за номерами і відкидає повтори.
            </span>
          </li>
        ) : (
          parts.map((part, i) => (
            <li key={i} className={cls(part === null && 'miss')}>
              <span className="t">Уривок {i + 1}</span>
              <span className="d">{part ?? 'ще не прийнято'}</span>
            </li>
          ))
        )}
      </ul>
      <p className="order">Уривки беруться лише з кадрів із печаткою станції: перехоплене без печатки сюди не потрапляє.</p>
    </div>
  )
}

interface Card {
  to: string
  icon: IconName
  title: string
  dd: string
  needsSession: boolean
  cur?: boolean
}

function CabinetCards({ ether }: { ether: EtherSnapshot }) {
  const { session } = useAuth()
  const cabinet = useCabinet()
  const counts = useNavCounts()
  const summary = cabinet?.summary
  const repository = cabinet?.repository
  const access = repository ? accessStatusOf(repository.accessStatus) : undefined

  const cards: Card[] = [
    session
      ? {
          to: '/contact',
          icon: 'repo',
          title: 'Заявка і доступ',
          dd:
            repository === undefined
              ? 'Читаємо статус репозиторію…'
              : repository === null
                ? 'Заявки на репозиторій немає'
                : `Доступ: ${access?.label ?? repository.accessStatus}`,
          needsSession: false,
          cur: repository?.accessStatus !== 'verified',
        }
      : {
          to: '/contact',
          icon: 'repo',
          title: 'Вихід на зв’язок',
          dd: 'Реєстрація в просвіт, заготовка заявки або вхід',
          needsSession: false,
          cur: true,
        },
    {
      to: '/inbox',
      icon: 'mail',
      title: 'Листи',
      dd: counts.unread > 0 ? `Непрочитаних: ${String(counts.unread)}` : 'Особисті листи й сповіщення сервера',
      needsSession: true,
      cur: counts.unread > 0,
    },
    {
      to: '/stages',
      icon: 'parts',
      title: 'Частини завдання',
      dd: summary
        ? `Видано: ${String(summary.releasedStages)}, не підтверджено: ${String(counts.stages)}`
        : 'Частина 2 виходить 28.09',
      needsSession: true,
      cur: counts.stages > 0,
    },
    {
      to: '/news',
      icon: 'news',
      title: 'Оголошення',
      dd: summary?.latestNews ? `Останнє - ${formatDay(summary.latestNews)}` : 'Оперативна стрічка мережі',
      needsSession: true,
    },
    {
      to: '/roll',
      icon: 'roll',
      title: 'Журнал виходу',
      dd: ether.station.onAir !== null ? `У журналі: ${String(ether.station.onAir)}` : 'Публічний журнал просвіту',
      needsSession: false,
    },
  ]

  return (
    <div>
      <div className="sh">
        <h2>Кабінет</h2>
        <span className="meta">{session ? session.user.username : 'після входу'}</span>
      </div>
      <ul className="docs">
        {cards.map((card) =>
          card.needsSession && !session ? (
            <li key={card.to}>
              <div className="shut">
                <span className="ic">
                  <Icon name={card.icon} />
                </span>
                <span>
                  <b>{card.title}</b>
                  <span className="dd">{card.dd}</span>
                </span>
                <span className="go dim">після входу</span>
              </div>
            </li>
          ) : (
            <li key={card.to}>
              <Link to={card.to} className={cls(card.cur && 'cur')}>
                <span className="ic">
                  <Icon name={card.icon} />
                </span>
                <span>
                  <b>{card.title}</b>
                  <span className="dd">{card.dd}</span>
                </span>
                <span className="go">
                  <Icon name="go" />
                </span>
              </Link>
            </li>
          ),
        )}
      </ul>
    </div>
  )
}

const LOG_FOLDED = 8

function ReceptionLog({ ether }: { ether: EtherSnapshot }) {
  const [all, setAll] = useState(false)
  const rows = all ? ether.log : ether.log.slice(0, LOG_FOLDED)

  return (
    <section className="home-sec wrap" aria-label="Журнал прийому">
      <div className="sh">
        <h2>Журнал прийому</h2>
        <span className="meta">останні запити до ефіру, найсвіжіші згори</span>
      </div>
      {ether.log.length === 0 ? (
        <p className="order">Поки порожньо: перший запит піде, щойно клієнт почне слухати.</p>
      ) : (
        <div className="tbl log">
          <table>
            <thead>
              <tr>
                <th>Час</th>
                <th>Маршрут</th>
                <th>Результат</th>
                <th>Код</th>
                <th>Подробиці</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => {
                const outcome = OUTCOME[entry.outcome]
                return (
                  <tr key={entry.id}>
                    <td data-label="Час" className="num">
                      {formatLocalTime(entry.atMs)}
                    </td>
                    <td data-label="Маршрут">
                      <code>{entry.route}</code>
                    </td>
                    <td data-label="Результат">
                      <span className={`tone ${outcome.tone}`}>
                        <i className="lamp" />
                        {outcome.label}
                      </span>
                    </td>
                    <td data-label="Код" className="num">
                      {entry.status ?? ''}
                    </td>
                    <td data-label="Подробиці">{entry.detail ?? ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {ether.log.length > LOG_FOLDED && (
        <button
          type="button"
          className="lk more"
          onClick={() => {
            setAll(!all)
          }}
        >
          {all ? 'Згорнути' : `Показати всі (${String(ether.log.length)})`}
        </button>
      )}
    </section>
  )
}
