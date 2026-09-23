import { useState, type SubmitEvent } from 'react'
import { useAuth } from '../app/auth-context'
import { useCabinet, useCabinetStore } from '../app/cabinet-context'
import { REGISTER_CODE_MESSAGE } from '../auth/register'
import { parseMe, parseRepositoryEnvelope } from '../auth/schemas'
import { checkRepository, parseRepository, type Lang } from '../auth/validate'
import { parseDeveloperCheck, type DeveloperCheck } from '../cabinet/schemas'
import { describeFailure } from '../cabinet/store'
import { SEASON } from '../config/season'
import { formatDayTime, formatLocal, zoneLabel } from '../lib/time'
import { useRadio, useRadioState } from '../sound/radio-context'
import { Icon } from '../ui/Icon'
import { OnOff, Seg } from '../ui/Seg'
import { accessStatusOf, reasonText } from './auth-labels'

/** Shown in place of a step that needs a session. */
export function Shut({ children }: { children: string }) {
  return (
    <p className="shut-box">
      <Icon name="lock" />
      {children}
    </p>
  )
}

/** Repository, status and reason; reread when the summary's repositoryAt moves (CL-24, CL-25). */
export function AccessStatus() {
  const cabinet = useCabinet()
  const store = useCabinetStore()
  if (!cabinet) return <Shut>Статус з'явиться після реєстрації або входу.</Shut>
  const { repository } = cabinet
  const status = repository ? accessStatusOf(repository.accessStatus) : undefined

  return (
    <>
      {repository === undefined && (
        <p className="note">
          {cabinet.noise ? 'Поки станція в шумі, сервер не відповідає: статус прочитаємо, коли ефір стихне.' : 'Читаємо статус…'}
        </p>
      )}
      {repository === null && <p className="callout warn">Заявки на репозиторій немає: вкажіть його нижче.</p>}
      {repository && (
        <div className="tbl c2">
          <table>
            <tbody>
              <tr>
                <td>Репозиторій</td>
                <td>
                  <a href={repository.url} target="_blank" rel="noopener noreferrer">
                    {repository.url}
                  </a>
                </td>
              </tr>
              <tr>
                <td>Статус</td>
                <td>
                  <span className={`tone ${status?.tone ?? 'muted'}`}>
                    <i className="lamp" />
                    {status?.label ?? repository.accessStatus}
                  </span>
                </td>
              </tr>
              <tr>
                <td>Причина</td>
                <td>{reasonText(repository) ?? '—'}</td>
              </tr>
              <tr>
                <td>Перевірено</td>
                <td className="num">
                  {repository.checkedAt ? `${formatLocal(repository.checkedAt)} (${zoneLabel()})` : 'рішення ще не було'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {repository?.verifiedElsewhere && (
        <p className="callout err">
          Цей репозиторій уже підтверджено за іншим акаунтом. Ваша заявка підтвердитися не може: перевірте .zoria і
          напишіть організаторам.
        </p>
      )}
      <div className="acts">
        <button
          type="button"
          className="btn sm"
          disabled={cabinet.noise}
          onClick={() => {
            void store?.refreshRepository()
          }}
        >
          <Icon name="refresh" />
          Оновити статус
        </button>
        <span className="note-inline">
          Строк: <span className="num">{formatDayTime(SEASON.accessDeadline)}</span> ({zoneLabel()}). Статус має бути
          «підтверджено».
        </span>
      </div>
    </>
  )
}

/** PUT /me/repository from the login session; status goes back to pending (CL-26). */
export function ChangeRepository() {
  const { session, call } = useAuth()
  const store = useCabinetStore()
  const cabinet = useCabinet()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  if (!session) return <Shut>Змінити репозиторій можна після входу.</Shut>
  const current = cabinet?.repository ?? null
  const verified = current?.accessStatus === 'verified'

  /** First press: checks and asks; the change itself needs a second, deliberate press. */
  function review() {
    const local = checkRepository(value)
    if (local) {
      setError(local)
      return
    }
    const parsed = parseRepository(value)
    const now = current ? parseRepository(current.url) : null
    if (parsed.ok && now?.ok && parsed.slug.toLowerCase() === now.slug.toLowerCase()) {
      setError('Це вже ваш поточний репозиторій.')
      return
    }
    setError(null)
    setConfirming(true)
  }

  async function change() {
    const local = checkRepository(value)
    if (local) {
      setError(local)
      return
    }
    const parsed = parseRepository(value)
    setBusy(true)
    setError(null)
    const result = await call({
      method: 'PUT',
      path: '/me/repository',
      body: { url: parsed.ok ? parsed.slug : value.trim() },
      parse: parseRepositoryEnvelope,
      retry: { transient: false, busy: true, maxAttempts: 3 },
    })
    setBusy(false)
    setConfirming(false)
    if (result.ok) {
      setValue('')
      store?.setRepository(result.data.repository)
      return
    }
    const failure = result.error
    if (failure.kind === 'http' && failure.status === 401) return
    const code = failure.kind === 'http' ? failure.code : failure.kind === 'network' ? failure.reason : null
    if (code === 'session-required') setError('Зміна можлива тільки із сесії входу. Увійдіть логіном і паролем.')
    else setError((code && REGISTER_CODE_MESSAGE[code]) ?? 'Не вдалося змінити репозиторій.')
  }

  function onSubmit(event: SubmitEvent) {
    event.preventDefault()
    if (busy) return
    if (confirming) void change()
    else review()
  }

  return (
    <>
      <p>
        Будь-який ваш приватний репозиторій на GitHub. Після зміни статус знову «очікує»: запрошення й .zoria потрібні
        заново.
      </p>
      <form className="inline-form" onSubmit={onSubmit}>
        <input
          placeholder="owner/repo"
          aria-label="Новий репозиторій"
          value={value}
          disabled={confirming}
          onChange={(e) => {
            setValue(e.target.value)
            setError(null)
          }}
        />
        <button type="submit" className={confirming ? 'btn pri' : 'btn'} disabled={busy || value.trim() === ''}>
          <Icon name="repo" />
          {busy ? 'Змінюємо…' : confirming ? 'Так, змінити' : 'Змінити'}
        </button>
        {confirming && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              setConfirming(false)
            }}
          >
            Скасувати
          </button>
        )}
      </form>
      {confirming && (
        <p className={verified ? 'callout err' : 'callout warn'}>
          {verified ? (
            <>
              <b>Зараз доступ підтверджено.</b> Після зміни статус повернеться в «очікує», і його доведеться
              підтвердити заново до {formatDayTime(SEASON.accessDeadline)} ({zoneLabel()}). Не підтверджено до строку -
              вибування.
            </>
          ) : (
            <>Статус повернеться в «очікує»: новий репозиторій треба буде запросити й покласти в нього .zoria.</>
          )}
        </p>
      )}
      {error && <p className="note err">{error}</p>}
    </>
  )
}

const LANGS = [
  { value: 'uk', label: 'Українська' },
  { value: 'en', label: 'English' },
] as const

/** Sound of the station, language of server texts (CL-42), an exchange check (POST /developer/check). */
export function Settings() {
  const { session, call, setSession } = useAuth()
  const radio = useRadio()
  const sound = useRadioState()
  const [langNote, setLangNote] = useState<string | null>(null)
  const [check, setCheck] = useState<DeveloperCheck | string | null>(null)

  async function changeLang(lang: Lang) {
    if (!session) return
    setLangNote(null)
    const result = await call({ method: 'PATCH', path: '/me', body: { lang }, parse: parseMe })
    if (result.ok) {
      setSession({ ...session, user: result.data })
      setLangNote('Збережено. Новою мовою прийдуть сповіщення і причини рішень щодо репозиторію.')
    } else {
      setLangNote(describeFailure(result) ?? 'Не вдалося змінити мову.')
    }
  }

  async function runCheck() {
    const echo = 'Зоря ✓ перевірка обміну'
    const result = await call({ method: 'POST', path: '/developer/check', body: { echo }, parse: parseDeveloperCheck })
    if (!result.ok) {
      setCheck(describeFailure(result) ?? 'Перевірка не вдалася.')
      return
    }
    setCheck(result.data.echo === echo ? result.data : 'Сервер повернув echo зі змінами.')
  }

  return (
    <ul className="short">
      <li>
        <span className="t">Сигнали подій</span>
        <span className="d">
          <OnOff
            label="Сигнали подій"
            value={sound.signals}
            onChange={(on) => {
              radio.setSignals(on)
            }}
          />
          <span className="dd">Провісник, просвіт, реєстрація, лист, нова частина, збої. Клавіша M вимикає все.</span>
        </span>
      </li>
      <li>
        <span className="t">Голос станції</span>
        <span className="d">
          <OnOff
            label="Голос станції"
            value={sound.voice}
            disabled={!sound.signals}
            onChange={(on) => {
              radio.setVoice(on)
            }}
          />
          <span className="dd">Коротка фраза станції після сигналу: «Просвіт відкрито. Вийдіть на зв'язок».</span>
        </span>
      </li>
      <li>
        <span className="t">Мова листів</span>
        <span className="d">
          {session ? (
            <>
              <Seg
                label="Мова листів сервера"
                options={LANGS}
                value={session.user.lang}
                onChange={(lang: Lang) => {
                  void changeLang(lang)
                }}
              />
              <span className="dd">{langNote ?? 'Мова сповіщень сервера і причин рішень щодо репозиторію.'}</span>
            </>
          ) : (
            <span className="dd">Обирається в заявці; після входу її можна змінити тут.</span>
          )}
        </span>
      </li>
      <li>
        <span className="t">Перевірка обміну</span>
        <span className="d">
          {session ? (
            <>
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  void runCheck()
                }}
              >
                <Icon name="refresh" />
                Перевірити
              </button>
              {check === null ? (
                <span className="dd">Надсилає рядок із кирилицею й символами і звіряє відповідь сервера.</span>
              ) : typeof check === 'string' ? (
                <span className="dd err">{check}</span>
              ) : (
                <span className="dd ok">
                  echo без змін ·{' '}
                  {Object.entries(check.checks)
                    .map(([k, v]) => `${k}: ${v ? 'так' : 'ні'}`)
                    .join(', ')}
                </span>
              )}
            </>
          ) : (
            <span className="dd">Після входу.</span>
          )}
        </span>
      </li>
    </ul>
  )
}
