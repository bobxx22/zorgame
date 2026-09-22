import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ApiResult } from '../api/client'
import type { Session } from '../auth/schemas'
import { browserSessionStore, isExpired } from '../auth/session-store'
import { AuthContext, type AuthCallOptions, type AuthState } from './auth-context'
import { useServer } from './server-context'

/** Session per server: switching servers mounts a fresh one. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { server } = useServer()
  return (
    <ServerSession key={server.id} serverId={server.id}>
      {children}
    </ServerSession>
  )
}

/** Restored from storage, dropped on 401 or expiry (CL-20 - CL-22). */
function ServerSession({ serverId, children }: { serverId: string; children: ReactNode }) {
  const { api } = useServer()
  const store = useMemo(() => browserSessionStore(serverId), [serverId])
  const [session, setSessionState] = useState<Session | null>(() => {
    const saved = store.load()
    return saved && !isExpired(saved, Date.now()) ? saved : null
  })
  const [lost, setLost] = useState(false)
  // Read by `call` so a request made right after login already carries the token.
  const sessionRef = useRef(session)

  /**
   * A session lost while in use stays on screen until the participant logs in
   * again or closes the dialog, so the page and everything typed on it survive
   * (CL-21). Its token is no longer sent.
   */
  const drop = useCallback(
    (becauseLost: boolean) => {
      sessionRef.current = null
      store.save(null)
      if (becauseLost) setLost(true)
      else setSessionState(null)
    },
    [store],
  )

  const setSession = useCallback(
    (next: Session) => {
      sessionRef.current = next
      store.save(next)
      setSessionState(next)
      setLost(false)
    },
    [store],
  )

  // Expiry ends the session like a 401 would.
  useEffect(() => {
    if (!session || lost) return
    const left = Date.parse(session.expiresAt) - Date.now()
    const timer = window.setTimeout(
      () => {
        drop(true)
      },
      Math.max(0, Math.min(left, 2 ** 31 - 1)),
    )
    return () => {
      window.clearTimeout(timer)
    }
  }, [session, lost, drop])

  const call = useCallback(
    async <T,>(options: AuthCallOptions<T>): Promise<ApiResult<T>> => {
      const current = sessionRef.current
      const result = await api.call<T>({ ...options, token: current?.token ?? null })
      if (!result.ok && result.error.kind === 'http' && result.error.status === 401 && current) {
        if (sessionRef.current === current) drop(true)
      }
      return result
    },
    [api, drop],
  )

  const logout = useCallback(async () => {
    const current = sessionRef.current
    drop(false)
    if (!current) return
    await api.call({
      method: 'POST',
      path: '/auth/logout',
      body: {},
      token: current.token,
      parse: () => true,
      retry: { transient: false, busy: true, maxAttempts: 3 },
    })
  }, [api, drop])

  const dismissLost = useCallback(() => {
    setLost(false)
    if (!sessionRef.current) setSessionState(null)
  }, [])

  const value = useMemo<AuthState>(
    () => ({ session, lost, setSession, logout, dismissLost, call }),
    [session, lost, setSession, logout, dismissLost, call],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
