import { readJson, removeKey, writeJson } from '../lib/storage'
import { parseSession, type Session } from './schemas'

/**
 * The session lives in memory and in this browser's storage, per server
 * (CL-20). It never goes into URLs, logs or the repository.
 */
export interface SessionStore {
  load(): Session | null
  save(session: Session | null): void
  /** Calls back when another tab logged in or out on this server; returns the unsubscribe. */
  watch(onChange: () => void): () => void
}

export function browserSessionStore(serverId: string): SessionStore {
  const name = `zoria.session.${serverId}`
  return {
    watch(onChange) {
      const listener = (event: StorageEvent) => {
        if (event.key === name || event.key === null) onChange()
      }
      window.addEventListener('storage', listener)
      return () => {
        window.removeEventListener('storage', listener)
      }
    },
    load() {
      const stored = readJson(name)
      return stored === null ? null : parseSession(stored)
    },
    save(session) {
      if (session) writeJson(name, session)
      else removeKey(name)
    },
  }
}

export function isExpired(session: Session, nowMs: number): boolean {
  return Date.parse(session.expiresAt) <= nowMs
}

/** Warn about the end of the session this long before it (CL-22). */
export const EXPIRY_WARNING_MS = 60 * 60 * 1000
