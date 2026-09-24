import { useState } from 'react'
import { useLocation } from 'react-router'
import { useAuth } from '../app/auth-context'
import { useCabinet } from '../app/cabinet-context'
import { useEther } from '../app/ether-context'
import { useRegistration } from '../app/registration-context'
import { useServer } from '../app/server-context'
import { useConfig } from '../app/use-config'
import { normalizeUsername, parseRepository } from '../auth/validate'
import { ORGANIZER_GITHUB, SEASON } from '../config/season'
import { serverNow } from '../ether/station'
import { formatDayTime, formatDuration, formatLocal, zoneLabel } from '../lib/time'
import { useNow } from '../lib/use-now'
import { CopyButton } from '../ui/CopyButton'
import { DocPage } from '../ui/DocPage'
import { Icon } from '../ui/Icon'
import { Seg } from '../ui/Seg'
import { Toc, type TocItem } from '../ui/Toc'
import { AccessStatus, ChangeRepository, Settings, Shut } from './AccessSections'
import { accessStatusOf } from './auth-labels'
import { LOOK_LABEL, lookCountdown, lookOf } from './ether-labels'
import { LoginForm } from './LoginForm'
import { RegisterForm } from './RegisterForm'

type Mode = 'register' | 'login'

const MODES = [
  { value: 'register', label: 'Нова заявка' },
  { value: 'login', label: 'У мене вже є акаунт' },
] as const

/**
 * "Вихід на зв'язок" as one of the site's documents: registration and access
 * are the numbered steps of one procedure, with the contents rail beside them.
 */
export function ContactPage() {
  const { session } = useAuth()
  const cabinet = useCabinet()
  const { station } = useEther()
  const { server } = useServer()
  const location = useLocation()
  const now = useNow()
  const look = lookOf(station)
  const count = lookCountdown(station, serverNow(station, now))
  const repository = cabinet?.repository
  const access = repository ? accessStatusOf(repository.accessStatus) : undefined

  const lead = session
    ? `Ви в журналі мережі. Лишилося відкрити доступ до репозиторію: запрошення, файл .zoria і статус «підтверджено» до ${formatDayTime(SEASON.accessDeadline)}.`
    : station.phase === 'window'
      ? 'Просвіт відкрито: реєстрація працює. Заповніть заявку, далі - запрошення організаторів і файл .zoria у репозиторії.'
      : station.phase === 'after'
        ? 'Просвіт минув, реєстрацію закрито. Якщо ви вже вийшли на зв’язок, увійдіть: доступ і кабінет працюють далі.'
        : 'Реєстрація працює тільки в просвіт. Заготуйте заявку зараз - клієнт надішле її сам за першим перевіреним кадром просвіту.'

  const locked = !session
  const toc: TocItem[] = [
    { id: 'application', n: '1', label: session ? 'Акаунт' : 'Заявка' },
    { id: 'invite', n: '2', label: 'Запрошення організаторів' },
    { id: 'marker', n: '3', label: 'Файл .zoria' },
    {
      id: 'status',
      n: '4',
      label: 'Статус доступу',
      dim: locked,
      chips: access ? <span className={`chip ${access.tone}`}>{access.label}</span> : undefined,
    },
    { id: 'change', n: '5', label: 'Зміна репозиторію', dim: locked },
    { id: 'settings', n: '6', label: 'Налаштування' },
  ]

  return (
    <DocPage
      crumbs={[{ to: '/', label: 'Ефір' }]}
      here="Вихід на зв'язок"
      title="Вихід на зв'язок"
      lead={lead}
      meta={
        <>
          <span className={`pill look-${look}`}>
            <i className="lamp" />
            {LOOK_LABEL[look]}
            {count && (
              <span className="num">
                {' · '}
                {count.label} {formatDuration(count.ms)}
              </span>
            )}
          </span>
          <span>
            <Icon name="mast" />
            {server.label}
          </span>
          <span>
            <Icon name="calendar" />
            доступ до {formatDayTime(SEASON.accessDeadline)}
          </span>
          <span>
            <Icon name="clock" />
            {zoneLabel()}
          </span>
        </>
      }
      toc={<Toc items={toc} />}
    >
      {cabinet?.noise && (
        <p className="callout warn">
          Станція в шумі: до просвіту сервер відповідає перешкодами. Статус оновиться, коли ефір стихне.
        </p>
      )}
      {cabinet?.problem && <p className="callout err">{cabinet.problem}</p>}

      <h2 id="application">
        <span className="hn">1</span>
        {session ? 'Акаунт' : 'Заявка'}
      </h2>
      {session ? <Account /> : <Application key={location.key} />}

      <h2 id="invite">
        <span className="hn">2</span>Запрошення організаторів
      </h2>
      <Invite />

      <h2 id="marker">
        <span className="hn">3</span>Файл .zoria
      </h2>
      <Marker />

      <h2 id="status">
        <span className="hn">4</span>Статус доступу
      </h2>
      <AccessStatus />

      <h2 id="change">
        <span className="hn">5</span>Зміна репозиторію
      </h2>
      <ChangeRepository />

      <h2 id="settings">
        <span className="hn">6</span>Налаштування
      </h2>
      <Settings />
    </DocPage>
  )
}

function Application() {
  const { station } = useEther()
  const { status } = useRegistration()
  const location = useLocation()
  const asked = (location.state as { mode?: string } | null)?.mode === 'login' ? 'login' : null
  const [chosen, setChosen] = useState<Mode | null>(asked)
  // An application with a fate of its own (armed, sending, failed) keeps its form in sight.
  const inPlay = status.state !== 'idle'
  const mode: Mode = chosen ?? (station.phase === 'after' && !inPlay ? 'login' : 'register')

  return (
    <>
      <div className="mode">
        <Seg label="Заявка чи вхід" options={MODES} value={mode} onChange={setChosen} />
      </div>
      {mode === 'register' ? (
        <RegisterForm />
      ) : (
        <div className="formbox">
          <LoginForm />
        </div>
      )}
    </>
  )
}

function Account() {
  const { session } = useAuth()
  const { status } = useRegistration()
  if (!session) return null
  return (
    <>
      {status.state === 'done' && (
        <p className="callout ok">
          <b>Реєстрацію виконано.</b>{' '}
          {status.via === 'login'
            ? 'Відповідь на заявку загубилася, але акаунт створено: клієнт перевірив це входом.'
            : 'Вас записано в журнал виходу на зв’язок.'}
        </p>
      )}
      <ul className="short">
        <li>
          <span className="t">Логін</span>
          <span className="d">
            <code>{session.user.username}</code>
          </span>
        </li>
        <li>
          <span className="t">Ім'я в журналі</span>
          <span className="d">
            {session.user.displayName} <span className="dd">Його бачать усі в публічному журналі.</span>
          </span>
        </li>
        <li>
          <span className="t">Мова листів</span>
          <span className="d">{session.user.lang === 'en' ? 'English' : 'українська'}</span>
        </li>
        <li>
          <span className="t">Сесія</span>
          <span className="d num">до {formatLocal(session.expiresAt)}</span>
        </li>
      </ul>
    </>
  )
}

/** Whom to invite, with which permission (CL-19, CL-23). */
function Invite() {
  const { session } = useAuth()
  const cabinet = useCabinet()
  const { draft } = useRegistration()
  const config = useConfig()
  const access = config.status === 'ready' ? config.config.repositoryAccess : null
  const githubUsername = access?.githubUsername ?? ORGANIZER_GITHUB
  const repositoryUrl = cabinet?.repository?.url ?? (session ? null : draft.repository)
  const repo = repositoryUrl ? parseRepository(repositoryUrl) : null
  const settingsUrl = repo?.ok ? `${repo.url}/settings/access` : null

  return (
    <>
      <p>
        Запросіть до свого репозиторію GitHub-акаунт організаторів <code>{githubUsername}</code>{' '}
        <CopyButton text={githubUsername} />
        {access ? (
          <>
            . Право: {access.permission}.
          </>
        ) : (
          '.'
        )}
      </p>
      {config.status !== 'ready' && <p className="note">Ім'я акаунта взято з ТЗ: сервер його ще не підтвердив.</p>}
      {settingsUrl && (
        <ul className="docs one">
          <li>
            <a href={settingsUrl} target="_blank" rel="noopener noreferrer">
              <span className="ic">
                <Icon name="external" />
              </span>
              <span>
                <b>Налаштування доступу репозиторію</b>
                <span className="dd">{settingsUrl.replace('https://', '')}</span>
              </span>
              <span className="go">
                <Icon name="go" />
              </span>
            </a>
          </li>
        </ul>
      )}
      <ul>
        <li>Бот бачить запрошення лише після реєстрації; запрошення GitHub чинне сім днів.</li>
        <li>Далі він перевіряє заявку сам: після запрошення, після зміни заявки і раз на 10 хвилин.</li>
        <li>
          Тримайте репозиторій <strong>приватним</strong>: у відкритий бот не заходить, і заявка отримує «потребує
          уваги».
        </li>
      </ul>
      {access?.instructions && <blockquote>{access.instructions}</blockquote>}
    </>
  )
}

function Marker() {
  const { session } = useAuth()
  const { draft } = useRegistration()
  const username = session?.user.username ?? normalizeUsername(draft.username)
  const login = username || 'ваш-логін'
  const command = `printf '%s\\n' ${login} > .zoria && git add .zoria && git commit -m "Зоря.нет: логін у мережі" && git push`
  // Windows PowerShell 5.1 writes `>` as UTF-16 with a BOM, which the bot may not read: ASCII explicitly.
  const powershell = `Set-Content -Path .zoria -Value ${login} -Encoding ascii; git add .zoria; git commit -m "Zoria: login"; git push`

  return (
    <>
      <p>
        Покладіть у корінь гілки за замовчуванням файл <code>.zoria</code> з вашим логіном у мережі
        {username ? (
          <>
            : <code>{username}</code>.
          </>
        ) : (
          <>
            {' '}
            - тим, що в заявці: <span className="ph">логін</span>.
          </>
        )}
      </p>
      <figure className="code">
        <figcaption>
          <span className="lang">bash, Git Bash</span>
          <span className="acts2">
            <CopyButton text={command} />
          </span>
        </figcaption>
        <pre>{command}</pre>
      </figure>
      <figure className="code">
        <figcaption>
          <span className="lang">Windows PowerShell</span>
          <span className="acts2">
            <CopyButton text={powershell} />
          </span>
        </figcaption>
        <pre>{powershell}</pre>
      </figure>
      <p className="note">
        У PowerShell не пишіть <code>echo … &gt; .zoria</code>: він збереже файл у UTF-16, і бот може не прочитати логін.
      </p>
      {!session && <Shut>Бот прочитає файл лише після реєстрації: до неї заявки для нього не існує.</Shut>}
    </>
  )
}
