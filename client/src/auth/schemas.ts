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

type Rec = Record<string, unknown>

function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const str = (v: unknown): v is string => typeof v === 'string'
const strOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string'
const isTime = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v))
const TOKEN = /^[A-Za-z0-9_-]{43}$/

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
