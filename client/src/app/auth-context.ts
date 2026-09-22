import { createContext, useContext } from 'react'
import type { ApiResult, CallOptions } from '../api/client'
import type { Session } from '../auth/schemas'

export type AuthCallOptions<T> = Omit<CallOptions<T>, 'token'>

export interface AuthState {
  /** The current session; after a loss it stays visible, without its token, until login or dismissal. */
  session: Session | null
  /** The session ended while in use (401 or expiry): the login dialog opens over the current screen. */
  lost: boolean
  setSession: (session: Session) => void
  logout: () => Promise<void>
  dismissLost: () => void
  /** Call with Authorization; a 401 drops the session and raises `lost` (CL-21). */
  call: <T>(options: AuthCallOptions<T>) => Promise<ApiResult<T>>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const state = useContext(AuthContext)
  if (!state) throw new Error('useAuth must be used inside <AuthProvider>')
  return state
}
