import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { systemClock } from '../api/clock'
import { REGISTER_CODE_MESSAGE, registerWithRecovery } from '../auth/register'
import { parseConfig } from '../auth/schemas'
import { hasErrors, validateRegister, type FieldErrors, type RegisterForm } from '../auth/validate'
import { useAuth } from './auth-context'
import { useEther } from './ether-context'
import { RegistrationContext, type RegistrationState, type RegistrationStatus } from './registration-context'
import { useServer } from './server-context'

const EMPTY: RegisterForm = { username: '', displayName: '', password: '', repository: '', lang: 'uk' }

interface Stored {
  draft: RegisterForm
  armed: boolean
}

/**
 * The draft lives in this tab's sessionStorage. The password is kept there only
 * while the application is armed: it stays with the participant, never in the
 * repository (CL-16), and is gone when the tab is closed.
 */
function storage(serverId: string) {
  const name = `zoria.registerDraft.${serverId}`
  return {
    load(): Stored {
      try {
        const raw = window.sessionStorage.getItem(name)
        if (!raw) return { draft: EMPTY, armed: false }
        const parsed = JSON.parse(raw) as Partial<Stored>
        return { draft: { ...EMPTY, ...parsed.draft }, armed: parsed.armed === true }
      } catch {
        return { draft: EMPTY, armed: false }
      }
    },
    save(value: Stored) {
      try {
        const draft = value.armed ? value.draft : { ...value.draft, password: '' }
        window.sessionStorage.setItem(name, JSON.stringify({ draft, armed: value.armed }))
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
  const [draft, setDraftState] = useState<RegisterForm>(initial.draft)
  const [armed, setArmed] = useState(initial.armed)
  const [status, setStatus] = useState<RegistrationStatus>(initial.armed ? { state: 'armed' } : { state: 'idle' })
  const [serverErrors, setServerErrors] = useState<FieldErrors>({})
  const [touched, setTouched] = useState(false)
  const running = useRef<AbortController | null>(null)

  useEffect(() => {
    store.save({ draft, armed })
  }, [store, draft, armed])

  useEffect(
    () => () => {
      running.current?.abort()
    },
    [],
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
          onStep: (step) => {
            setStatus({ state: 'sending', step })
          },
        })
        if (outcome.kind === 'registered') {
          setSession(outcome.session)
          setArmed(false)
          setDraftState((prev) => ({ ...prev, password: '' }))
          setStatus({ state: 'done', via: outcome.via })
          return
        }
        if (outcome.kind === 'field') {
          setServerErrors({ [outcome.field]: REGISTER_CODE_MESSAGE[outcome.code] ?? outcome.code })
          setArmed(false)
        }
        if (outcome.kind !== 'aborted') setStatus({ state: 'error', outcome })
      } finally {
        running.current = null
      }
    },
    [api, setSession],
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
    setArmed(false)
    setStatus({ state: 'idle' })
  }, [])

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
