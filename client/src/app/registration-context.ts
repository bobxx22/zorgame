import { createContext, useContext } from 'react'
import type { RegisterOutcome, RegisterStep } from '../auth/register'
import type { FieldErrors, RegisterForm } from '../auth/validate'
import { isRecord } from '../lib/guards'
import { readJson } from '../lib/storage'

export type RegistrationStatus =
  | { state: 'idle' }
  | { state: 'armed' }
  | { state: 'checking' }
  | { state: 'sending'; step: RegisterStep }
  | { state: 'done'; via: 'register' | 'login' }
  | { state: 'error'; outcome: Exclude<RegisterOutcome, { kind: 'registered' }> }
  /** Armed and failed: the client tries again by itself at `atMs` (attempt counts from 1). */
  | { state: 'retrying'; atMs: number; attempt: number; outcome: Exclude<RegisterOutcome, { kind: 'registered' }> }

export interface RegistrationState {
  draft: RegisterForm
  setDraft: (patch: Partial<RegisterForm>) => void
  errors: FieldErrors
  status: RegistrationStatus
  /** Send now; in doubt about the phase, asks /public/config first. */
  submit: () => void
  /** Keep the application ready and send it on the first sealed window frame (CL-16). */
  arm: () => void
  disarm: () => void
}

export const RegistrationContext = createContext<RegistrationState | null>(null)

/** sessionStorage key of a server's draft. */
export function draftKey(serverId: string): string {
  return `zoria.registerDraft.${serverId}`
}

/** Whether an application is armed for that server in this tab (read without its provider). */
export function isArmedOn(serverId: string): boolean {
  const stored = readJson(draftKey(serverId), 'session')
  return isRecord(stored) && stored.armed === true
}

export function useRegistration(): RegistrationState {
  const state = useContext(RegistrationContext)
  if (!state) throw new Error('useRegistration must be used inside <RegistrationProvider>')
  return state
}
