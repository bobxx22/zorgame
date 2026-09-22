// Participant routes of the mock stand: config, register, login, logout, me,
// repository, summary. In-memory only; restarting the mock forgets everything.
//
//   MOCK_REPOS=bobxx22/zorgame    extra repositories in the admission list
//   MOCK_LOSE=0.15                share of registrations whose answer is lost
//   MOCK_BUSY=0.1                 share of register/login answered authentication-busy
//   MOCK_VERIFY_SEC=0             seconds until a repository turns verified (0: stays pending)

import { randomBytes, randomUUID } from 'node:crypto'

const LOSE = Number(process.env.MOCK_LOSE ?? 0.15)
const BUSY = Number(process.env.MOCK_BUSY ?? 0.1)
const VERIFY_SEC = Number(process.env.MOCK_VERIFY_SEC ?? 0)
const SESSION_MS = 24 * 60 * 60 * 1000

const ELIGIBLE = new Set([
  ...Array.from({ length: 20 }, (_, i) => `zoria-stand/station-${String(i + 1).padStart(2, '0')}`),
  ...(process.env.MOCK_REPOS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
])

const accounts = new Map() // username -> account
const sessions = new Map() // token -> { username, sessionId, expiresAt }
export const roll = []

const iso = (ms) => new Date(ms).toISOString()
const fail = (status, code, field) => ({ status, body: { error: field ? { code, field } : { code } } })

function publicUser(a) {
  return {
    id: a.id,
    username: a.username,
    displayName: a.displayName,
    role: 'participant',
    disabled: false,
    createdAt: a.createdAt,
    lang: a.lang,
  }
}

function repositoryOf(a) {
  const r = a.repository
  if (VERIFY_SEC > 0 && r.accessStatus === 'pending' && Date.now() - Date.parse(r.updatedAt) > VERIFY_SEC * 1000) {
    r.accessStatus = 'verified'
    r.reasonCode = 'marker-found'
    r.reason = 'Запрошення прийнято, файл .zoria у репозиторії називає ваш акаунт у мережі.'
    r.checkedAt = iso(Date.now())
    r.updatedAt = r.checkedAt
  }
  return { ...r }
}

function newSession(a) {
  const token = randomBytes(32).toString('base64url')
  const session = { username: a.username, sessionId: randomUUID(), expiresAt: iso(Date.now() + SESSION_MS) }
  sessions.set(token, session)
  return { token, sessionId: session.sessionId, expiresAt: session.expiresAt, user: publicUser(a) }
}

/** owner/repo from any accepted form, or an error code. */
function parseRepo(raw) {
  if (typeof raw !== 'string' || raw.length > 256) return { code: 'invalid-repository' }
  const input = raw.trim()
  if (/[?#]/.test(input)) return { code: 'repository-not-root' }
  const m =
    /^git@github\.com:(.+)$/i.exec(input) ?? /^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/i.exec(input)
  const path = (m ? m[1] : input).replace(/\/+$/, '')
  const parts = path.split('/')
  if (parts.length > 2) return { code: 'repository-not-root' }
  const [owner, repo = ''] = parts
  const name = repo.replace(/\.git$/i, '')
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner) || !/^[A-Za-z0-9._-]{1,100}$/.test(name)) {
    return { code: 'invalid-repository' }
  }
  return { slug: `${owner}/${name}`.toLowerCase() }
}

function exactFields(body, required, optional = []) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false
  const keys = Object.keys(body)
  return required.every((k) => keys.includes(k)) && keys.every((k) => required.includes(k) || optional.includes(k))
}

function authorized(req) {
  const m = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '')
  const session = m ? sessions.get(m[1]) : undefined
  if (!session || Date.parse(session.expiresAt) <= Date.now()) return null
  return accounts.get(session.username) ?? null
}

function config(phase) {
  return {
    apiVersion: 1,
    title: 'Зоря.нет (локальний стенд)',
    season: 'Зоря 2026',
    registrationOpen: phase === 'window',
    inviteRequired: false,
    repositoryRequired: true,
    repositoryAccess: {
      githubUsername: 'zoria-net-bot',
      permission: 'Write в особистому репозиторії, Read у репозиторії організації',
      instructions: 'Запросіть акаунт і покладіть у корінь файл .zoria з логіном у мережі.',
    },
    webClient: false,
  }
}

function register(body, phase, opensAt) {
  if (phase === 'after') return fail(403, 'registration-closed')
  if (!exactFields(body, ['username', 'displayName', 'password', 'repositoryUrl'], ['lang'])) {
    return fail(400, 'invalid-fields')
  }
  const { username, displayName, password, repositoryUrl, lang = 'uk' } = body
  if (typeof username !== 'string' || !/^[a-z][a-z0-9_-]{2,31}$/.test(username)) {
    return fail(422, 'invalid-field', 'username')
  }
  if (
    typeof displayName !== 'string' ||
    displayName.length < 1 ||
    displayName.length > 80 ||
    displayName !== displayName.trim() ||
    /[\n\r\t]/.test(displayName)
  ) {
    return fail(422, 'invalid-field', 'displayName')
  }
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
    return fail(422, 'invalid-field', 'password')
  }
  if (lang !== 'uk' && lang !== 'en') return fail(422, 'invalid-field', 'lang')
  const repo = parseRepo(repositoryUrl)
  if (repo.code) return fail(422, repo.code, 'repositoryUrl')
  if (!ELIGIBLE.has(repo.slug)) return fail(422, 'repository-not-eligible', 'repositoryUrl')
  if (accounts.has(username)) return fail(409, 'username-unavailable')

  const now = Date.now()
  const account = {
    id: randomUUID(),
    username,
    displayName,
    password,
    lang,
    createdAt: iso(now),
    repository: {
      url: `https://github.com/${repo.slug}`,
      accessStatus: 'pending',
      checkedAt: null,
      reason: null,
      reasonCode: null,
      updatedAt: iso(now),
      verifiedElsewhere: false,
    },
  }
  accounts.set(username, account)
  roll.push({ n: roll.length + 1, at: iso(now), sinceOpen: Math.max(0, Math.floor((now - opensAt) / 1000)), name: displayName })
  return { status: 201, body: newSession(account) }
}

function login(body) {
  if (!exactFields(body, ['username', 'password'])) return fail(400, 'invalid-fields')
  const account = accounts.get(String(body.username))
  if (!account || account.password !== body.password) return fail(401, 'invalid-credentials')
  return { status: 200, body: newSession(account) }
}

/**
 * Handles a participant route in the window or after it. Returns null for an
 * unknown route. `lose` is set when the answer should be dropped after the work
 * is done: the client then has to find out by logging in (CL-17).
 */
export function participant({ req, method, path, body, phase, opensAt }) {
  if (method === 'GET' && path === '/public/config') return { status: 200, body: config(phase) }

  if (method === 'POST' && (path === '/auth/register' || path === '/auth/login')) {
    if (Math.random() < BUSY) return { ...fail(429, 'authentication-busy'), retryAfter: 5 }
    if (path === '/auth/login') return login(body)
    const result = register(body, phase, opensAt)
    return result.status === 201 && Math.random() < LOSE ? { ...result, lose: true } : result
  }

  const account = authorized(req)
  const known = ['/auth/logout', '/me', '/me/repository', '/me/summary'].includes(path)
  if (!known) return null
  if (!account) return fail(401, 'authentication-required')

  if (method === 'POST' && path === '/auth/logout') {
    const token = req.headers.authorization.slice(7)
    sessions.delete(token)
    return { status: 204, body: null }
  }
  if (method === 'GET' && path === '/me') return { status: 200, body: { user: publicUser(account) } }
  if (method === 'PATCH' && path === '/me') {
    if (!exactFields(body, ['lang'])) return fail(400, 'invalid-fields')
    if (body.lang !== 'uk' && body.lang !== 'en') return fail(422, 'invalid-field', 'lang')
    account.lang = body.lang
    return { status: 200, body: { user: publicUser(account) } }
  }
  if (method === 'GET' && path === '/me/repository') {
    return { status: 200, body: { repository: repositoryOf(account) } }
  }
  if (method === 'PUT' && path === '/me/repository') {
    if (!exactFields(body, ['url'])) return fail(400, 'invalid-fields')
    const repo = parseRepo(body.url)
    if (repo.code) return fail(422, repo.code, 'url')
    if (!ELIGIBLE.has(repo.slug)) return fail(422, 'repository-not-eligible', 'url')
    const now = iso(Date.now())
    account.repository = {
      url: `https://github.com/${repo.slug}`,
      accessStatus: 'pending',
      checkedAt: null,
      reason: null,
      reasonCode: null,
      updatedAt: now,
      verifiedElsewhere: false,
    }
    return { status: 200, body: { repository: repositoryOf(account) } }
  }
  if (method === 'GET' && path === '/me/summary') {
    return {
      status: 200,
      body: {
        unread: 0,
        releasedStages: 0,
        acknowledgedStages: 0,
        latestNews: null,
        repositoryAt: repositoryOf(account).updatedAt,
        serverTime: iso(Date.now()),
      },
    }
  }
  return fail(404, 'not-found')
}

export function eligibleList() {
  return [...ELIGIBLE]
}
