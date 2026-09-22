import { parseSession, type Session } from './schemas'

/**
 * The session lives in memory and in this browser's storage, per server
 * (CL-20). It never goes into URLs, logs or the repository.
 */
export interface SessionStore {
  load(): Session | null
  save(session: Session | null): void
}

export function browserSessionStore(serverId: string): SessionStore {
  const name = `zoria.session.${serverId}`
  return {
    load() {
      try {
        const raw = window.localStorage.getItem(name)
        return raw === null ? null : parseSession(JSON.parse(raw) as unknown)
      } catch {
        return null
      }
    },
    save(session) {
      try {
        if (session) window.localStorage.setItem(name, JSON.stringify(session))
        else window.localStorage.removeItem(name)
      } catch {
        // Storage unavailable: the session lasts until the tab is closed.
      }
    },
  }
}

export function isExpired(session: Session, nowMs: number): boolean {
  return Date.parse(session.expiresAt) <= nowMs
}

/** Warn about the end of the session this long before it (CL-22). */
export const EXPIRY_WARNING_MS = 60 * 60 * 1000
