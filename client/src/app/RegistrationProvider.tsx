import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { systemClock } from '../api/clock'
import { armedRetryDelay, REGISTER_CODE_MESSAGE, registerWithRecovery } from '../auth/register'
import { parseConfig } from '../auth/schemas'
import { hasErrors, validateRegister, type FieldErrors, type RegisterForm } from '../auth/validate'
import { envInvitation } from '../config/invitation'
import { useAuth } from './auth-context'
import { useEther } from './ether-context'
import { draftKey, RegistrationContext, type RegistrationState, type RegistrationStatus } from './registration-context'
import { useServer } from './server-context'

const EMPTY: RegisterForm = { username: '', displayName: '', password: '', invitation: '', repository: '', lang: 'uk' }

interface Stored {
  draft: RegisterForm
  armed: boolean
  /** An answer to this application got lost: the account may exist (kept across reloads). */
  lost: boolean
}

/**
 * The draft lives in this tab's sessionStorage. The password is kept there only
 * while the application is armed: it stays with the participant, never in the
 * repository (CL-16), and is gone when the tab is closed.
 */
function storage(serverId: string) {
  const name = draftKey(serverId)
  return {
    load(): Stored {
      try {
        const raw = window.sessionStorage.getItem(name)
        if (!raw) return { draft: EMPTY, armed: false, lost: false }
        const parsed = JSON.parse(raw) as Partial<Stored>
        return { draft: { ...EMPTY, ...parsed.draft }, armed: parsed.armed === true, lost: parsed.lost === true }
      } catch {
        return { draft: EMPTY, armed: false, lost: false }
      }
    },
    save(value: Stored) {
      try {
        // The password and the one-time code are stored only while the application is armed.
        const draft = value.armed ? value.draft : { ...value.draft, password: '', invitation: '' }
        window.sessionStorage.setItem(name, JSON.stringify({ draft, armed: value.armed, lost: value.lost }))
      } catch {
        // No storage: the draft lives until reload.
      }
    },
  }
}

export function RegistrationProvider({ children }: { children: ReactNode }) {
  const { server } = useServer()
  return (
    <ServerRegistration key={server.id} serverId={server.id}>
      {children}
    </ServerRegistration>
  )
}

function ServerRegistration({ serverId, children }: { serverId: string; children: ReactNode }) {
  const { api } = useServer()
  const { setSession } = useAuth()
  const { station } = useEther()
  const store = useMemo(() => storage(serverId), [serverId])
  const [initial] = useState(() => store.load())
  // The code is kept only while armed; otherwise it comes back from .env.local (live server only).
  const [draft, setDraftState] = useState<RegisterForm>(() => ({
    ...initial.draft,
    invitation: initial.draft.invitation || envInvitation(serverId),
  }))
  const [armed, setArmed] = useState(initial.armed)
  const [status, setStatus] = useState<RegistrationStatus>(initial.armed ? { state: 'armed' } : { state: 'idle' })
  const [serverErrors, setServerErrors] = useState<FieldErrors>({})
  const [touched, setTouched] = useState(false)
  const running = useRef<AbortController | null>(null)
  // The armed loop: whether it is on, how many tries failed, whether any answer got lost, the next try.
  const armedRef = useRef(initial.armed)
  const streak = useRef(0)
  const lostBefore = useRef(initial.lost)
  const retryTimer = useRef<number | null>(null)

  const clearRetry = useCallback(() => {
    if (retryTimer.current !== null) window.clearTimeout(retryTimer.current)
    retryTimer.current = null
  }, [])

  useEffect(() => {
    store.save({ draft, armed, lost: lostBefore.current })
  }, [store, draft, armed, status.state])

  useEffect(() => {
    armedRef.current = armed
  }, [armed])

  useEffect(
    () => () => {
      running.current?.abort()
      clearRetry()
    },
    [clearRetry],
  )

  const errors = useMemo<FieldErrors>(
    () => (touched ? { ...validateRegister(draft), ...serverErrors } : serverErrors),
    [touched, draft, serverErrors],
  )

  const setDraft = useCallback((patch: Partial<RegisterForm>) => {
    setDraftState((prev) => ({ ...prev, ...patch }))
    // A server error belongs to the value that was sent; editing the field clears it.
    setServerErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => !(key in patch))))
  }, [])

  const send = useCallback(
    async (form: RegisterForm, checkWindow: boolean) => {
      if (running.current) return
      const controller = new AbortController()
      running.current = controller
      try {
        if (checkWindow) {
          setStatus({ state: 'checking' })
          // A parsed 200 with registrationOpen: true means the window (spec 3).
          const config = await api.call({
            path: '/public/config',
            parse: parseConfig,
            retry: { transient: false, busy: true, maxAttempts: 2 },
            signal: controller.signal,
          })
          if (!config.ok || !config.data.registrationOpen) {
            setStatus({ state: 'error', outcome: { kind: 'not-open' } })
            return
          }
        }
        setStatus({ state: 'sending', step: 'registering' })
        const outcome = await registerWithRecovery(form, {
          api,
          clock: systemClock,
          signal: controller.signal,
          lostBefore: lostBefore.current,
          onStep: (step) => {
            setStatus({ state: 'sending', step })
          },
        })
        if (outcome.kind === 'registered') {
          setSession(outcome.session)
          setArmed(false)
          streak.current = 0
          lostBefore.current = false
          setDraftState((prev) => ({ ...prev, password: '', invitation: '' }))
          setStatus({ state: 'done', via: outcome.via })
          return
        }
        if (outcome.kind === 'failed' && outcome.lost) lostBefore.current = true
        // Armed means "get it through": a busy queue, a limit or a lost answer is waited out, not reported.
        const delay = armedRef.current ? armedRetryDelay(outcome, streak.current) : null
        if (delay !== null && outcome.kind !== 'aborted') {
          streak.current += 1
          setStatus({ state: 'retrying', atMs: Date.now() + delay, attempt: streak.current, outcome })
          clearRetry()
          retryTimer.current = window.setTimeout(() => {
            retryTimer.current = null
            if (armedRef.current) setStatus({ state: 'armed' })
          }, delay)
          return
        }
        if (outcome.kind === 'field') {
          setServerErrors({ [outcome.field]: REGISTER_CODE_MESSAGE[outcome.code] ?? outcome.code })
          setArmed(false)
        }
        if (outcome.kind === 'closed') setArmed(false)
        if (outcome.kind !== 'aborted') setStatus({ state: 'error', outcome })
      } finally {
        running.current = null
      }
    },
    [api, setSession, clearRetry],
  )

  const submit = useCallback(() => {
    setTouched(true)
    if (hasErrors(validateRegister(draft))) return
    void send(draft, station.phase !== 'window')
  }, [draft, send, station.phase])

  const arm = useCallback(() => {
    setTouched(true)
    if (hasErrors(validateRegister(draft))) return
    setArmed(true)
    setStatus({ state: 'armed' })
  }, [draft])

  const disarm = useCallback(() => {
    // A request already on its way is not cut off: its answer may be the account.
    clearRetry()
    streak.current = 0
    setArmed(false)
    setStatus({ state: 'idle' })
  }, [clearRetry])

  // The window closed before an armed application got through: say so instead of waiting forever.
  useEffect(() => {
    if (!armed || station.phase !== 'after' || running.current) return
    clearRetry()
    streak.current = 0
    setArmed(false)
    setStatus({ state: 'error', outcome: { kind: 'closed' } })
  }, [armed, station.phase, status.state, clearRetry])

  // The armed application goes out on the first sealed window frame.
  useEffect(() => {
    if (armed && station.phase === 'window' && status.state === 'armed') {
      void send(draft, false)
    }
  }, [armed, station.phase, status.state, draft, send])

  const value = useMemo<RegistrationState>(
    () => ({ draft, setDraft, errors, status, submit, arm, disarm }),
    [draft, setDraft, errors, status, submit, arm, disarm],
  )
  return <RegistrationContext.Provider value={value}>{children}</RegistrationContext.Provider>
}
