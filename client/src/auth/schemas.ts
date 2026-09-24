import { isRecord } from '../lib/guards'
/**
 * Shape guards for 2xx bodies of part 1. A 2xx object that passes is a real
 * answer (spec 5.2: an API-like object never comes as noise). Unknown fields
 * are ignored; missing required ones fail the guard.
 */

export type AccessStatus = 'pending' | 'verified' | 'needs-attention'
export type ReasonCode = 'marker-found' | 'marker-other' | 'marker-absent' | 'inviter-mismatch' | 'organizer'

export interface User {
  id: string
  username: string
  displayName: string
  role: string
  disabled: boolean
  createdAt: string
  lang: 'uk' | 'en'
}

export interface Session {
  token: string
  sessionId: string
  expiresAt: string
  user: User
}

export interface RepositoryAccess {
  githubUsername: string
  permission: string
  instructions: string
}

export interface Config {
  apiVersion: number
  title: string
  season: string
  registrationOpen: boolean
  /** Since 22.09 the server asks for the application code in `invitation`. */
  inviteRequired: boolean
  repositoryAccess: RepositoryAccess | null
}

export interface Repository {
  url: string
  /** Known values or whatever the server sends; shown as is when unknown. */
  accessStatus: AccessStatus | (string & {})
  checkedAt: string | null
  reason: string | null
  reasonCode: ReasonCode | (string & {}) | null
  updatedAt: string
  verifiedElsewhere: boolean
}


const str = (v: unknown): v is string => typeof v === 'string'
const strOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string'
const isTime = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v))
/** A token is opaque: any non-empty header-safe string is taken, its exact form is the server's business. */
const TOKEN = /^[\x21-\x7e]{1,4096}$/

export function parseUser(value: unknown): User | null {
  if (!isRecord(value)) return null
  const { id, username, displayName, role, disabled, createdAt, lang } = value
  if (!str(id) || !str(username) || !str(displayName) || !str(role)) return null
  if (typeof disabled !== 'boolean' || !isTime(createdAt)) return null
  return { id, username, displayName, role, disabled, createdAt, lang: lang === 'en' ? 'en' : 'uk' }
}

export function parseSession(value: unknown): Session | null {
  if (!isRecord(value)) return null
  const { token, sessionId, expiresAt } = value
  const user = parseUser(value.user)
  if (!str(token) || !TOKEN.test(token) || !str(sessionId) || !isTime(expiresAt) || !user) return null
  return { token, sessionId, expiresAt, user }
}

/** Who registered or logged in, as the form knows it: stands in for a user part the client cannot read. */
export interface Applicant {
  username: string
  displayName: string
  lang: 'uk' | 'en'
}

/**
 * A 2xx of register or login means the session exists (for register: the
 * account too). Only the token is needed to go on; a user part or a time that
 * does not parse is filled from the form and the day the spec gives a session,
 * and /me reads the real user afterwards. A strict guard here would turn a
 * created account into endless "unexpected answer" retries.
 */
export function parseIssuedSession(applicant: Applicant, nowMs: () => number = Date.now) {
  return (value: unknown): Session | null => {
    if (!isRecord(value)) return null
    const { token, sessionId, expiresAt } = value
    if (!str(token) || !TOKEN.test(token)) return null
    const now = nowMs()
    const user = parseUser(value.user) ?? {
      id: '',
      username: applicant.username,
      displayName: applicant.displayName,
      role: 'participant',
      disabled: false,
      createdAt: new Date(now).toISOString(),
      lang: applicant.lang,
    }
    return {
      token,
      sessionId: str(sessionId) ? sessionId : '',
      expiresAt: isTime(expiresAt) ? expiresAt : new Date(now + SESSION_DAY_MS).toISOString(),
      user,
    }
  }
}

/** A user filled from the form, waiting for /me. */
export function isProvisional(user: User): boolean {
  return user.id === ''
}

const SESSION_DAY_MS = 24 * 60 * 60 * 1000

export function parseMe(value: unknown): User | null {
  return isRecord(value) ? parseUser(value.user) : null
}

export function parseConfig(value: unknown): Config | null {
  if (!isRecord(value)) return null
  const { apiVersion, title, season, registrationOpen, inviteRequired, repositoryAccess } = value
  if (typeof apiVersion !== 'number' || !str(title) || !str(season) || typeof registrationOpen !== 'boolean') {
    return null
  }
  let access: RepositoryAccess | null = null
  if (isRecord(repositoryAccess)) {
    const { githubUsername, permission, instructions } = repositoryAccess
    if (!str(githubUsername) || !str(permission) || !str(instructions)) return null
    access = { githubUsername, permission, instructions }
  } else if (repositoryAccess !== null) {
    return null
  }
  return {
    apiVersion,
    title,
    season,
    registrationOpen,
    inviteRequired: inviteRequired === true,
    repositoryAccess: access,
  }
}

export function parseRepositoryBody(value: unknown): Repository | null {
  if (!isRecord(value)) return null
  const { url, accessStatus, checkedAt, reason, reasonCode, updatedAt, verifiedElsewhere } = value
  if (!str(url) || !str(accessStatus) || !strOrNull(reason) || !strOrNull(reasonCode)) return null
  if (!(checkedAt === null || isTime(checkedAt)) || !isTime(updatedAt) || typeof verifiedElsewhere !== 'boolean') {
    return null
  }
  return { url, accessStatus, checkedAt, reason, reasonCode, updatedAt, verifiedElsewhere }
}

/** GET/PUT /me/repository: `{repository: Repository | null}`. */
export function parseRepositoryEnvelope(value: unknown): { repository: Repository | null } | null {
  if (!isRecord(value) || !('repository' in value)) return null
  if (value.repository === null) return { repository: null }
  const repository = parseRepositoryBody(value.repository)
  return repository ? { repository } : null
}
