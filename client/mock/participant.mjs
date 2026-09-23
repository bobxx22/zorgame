// Participant routes of the mock stand: config, register, login, logout, me,
// repository, summary, news, letters, task parts, developer check.
// In-memory only; restarting the mock forgets everything.
//
//   MOCK_INVITATION=STAND-2026    application code the stand accepts (like the training one)
//   MOCK_CODE_ONCE=1              a code works only once, like on the live server (0: reusable)
//   MOCK_CABINET_FAIL=0           share of cabinet reads (GET) that fail with 502, to test rereads
//   MOCK_LOSE=0.15                share of registrations whose answer is lost
//   MOCK_BUSY=0.1                 share of register/login answered authentication-busy
//   MOCK_VERIFY_SEC=0             seconds until a repository turns verified (0: stays pending)
//   MOCK_STAGE2_SEC=120           seconds after registration until "part 2" is released
//   MOCK_ERRATA_SEC=240           seconds after registration until part 2 gets an erratum

import { randomBytes, randomUUID } from 'node:crypto'

const LOSE = Number(process.env.MOCK_LOSE ?? 0.15)
const BUSY = Number(process.env.MOCK_BUSY ?? 0.1)
const VERIFY_SEC = Number(process.env.MOCK_VERIFY_SEC ?? 0)
const STAGE2_SEC = Number(process.env.MOCK_STAGE2_SEC ?? 120)
const ERRATA_SEC = Number(process.env.MOCK_ERRATA_SEC ?? 240)
const SESSION_MS = 24 * 60 * 60 * 1000

const INVITATION = process.env.MOCK_INVITATION ?? 'STAND-2026'
const CODE_ONCE = process.env.MOCK_CODE_ONCE !== '0'
const CABINET_FAIL = Number(process.env.MOCK_CABINET_FAIL ?? 0)
const usedCodes = new Set()

const accounts = new Map() // username -> account
const sessions = new Map() // token -> { username, sessionId, expiresAt }
export const roll = []

const iso = (ms) => new Date(ms).toISOString()
const fail = (status, code, field) => ({ status, body: { error: field ? { code, field } : { code } } })

// ---------- content ----------

const started = Date.now()

const news = [
  {
    id: randomUUID(),
    title: 'Локальний стенд піднято',
    body: 'Це **локальна імітація** мережі для розробки клієнта. Справжні новини приходять з `zoria.net`.\n\n- ефір і печатка\n- реєстрація і вхід\n- листи, новини, частини завдання',
    createdAt: iso(started),
    updatedAt: iso(started),
    publishedAt: iso(started),
    archivedAt: null,
  },
  {
    id: randomUUID(),
    title: 'Розклад кола',
    body: 'Шум, провісник, просвіт і після просвіту йдуть по колу. Деталі - у [README](https://github.com/bobxx22/zorgame).',
    createdAt: iso(started + 1),
    updatedAt: iso(started + 1),
    publishedAt: iso(started + 1),
    archivedAt: null,
  },
]

const STAGES = [
  {
    id: 'c1d2e3f4-0516-4728-99aa-bbccddeeff01',
    position: 1,
    title: 'Частина 1. Вихід на зв’язок',
    body: '# Вихід на зв’язок\n\nЗареєструйтеся в просвіт, запросіть акаунт організаторів і покладіть `.zoria`.\n\n1. Реєстрація\n2. Запрошення\n3. Файл `.zoria`',
    publishedAt: iso(started),
    at: 0,
  },
  {
    id: 'c1d2e3f4-0516-4728-99aa-bbccddeeff02',
    position: 2,
    title: 'Частина 2 (імітація)',
    body: [
      '# Частина 2 (імітація)',
      '',
      'Справжня частина 2 виходить **28.09** і приходить у список частин.',
      '',
      '## Що буде',
      '- правила гри і протокол',
      '- SDK і шаблон бота',
      '- наказ',
      '',
      '```ts',
      'const bot = "<script>alert(1)</script>" // показується як текст',
      '```',
      '',
      'Посилання [на сайт](https://zoria.net/) і [небезпечне](javascript:alert(1)).',
      '',
      '<b>HTML у тексті показується як є.</b>',
    ].join('\n'),
    publishedAt: iso(started),
    at: STAGE2_SEC * 1000,
  },
]

function letter(account, patch) {
  account.inbox.unshift({
    id: randomUUID(),
    messageId: null,
    stageId: null,
    kind: 'message',
    createdAt: iso(Date.now()),
    readAt: null,
    notice: null,
    ...patch,
  })
}

/** Time-driven events of an account: verification, part 2, its erratum. */
function advance(a) {
  const now = Date.now()
  const age = now - Date.parse(a.createdAt)
  const r = a.repository
  if (VERIFY_SEC > 0 && r.accessStatus === 'pending' && now - Date.parse(r.updatedAt) > VERIFY_SEC * 1000) {
    r.accessStatus = 'verified'
    r.reasonCode = 'marker-found'
    r.reason = 'Запрошення прийнято, файл .zoria у репозиторії називає ваш акаунт у мережі.'
    r.checkedAt = iso(now)
    r.updatedAt = r.checkedAt
    letter(a, {
      title: 'Доступ до репозиторію підтверджено',
      body: `Репозиторій ${r.url} підтверджено: ${r.reason}`,
      notice: { type: 'repository', url: r.url, accessStatus: r.accessStatus, reason: r.reason, reasonCode: r.reasonCode },
    })
  }
  for (const stage of STAGES) {
    if (age >= stage.at && !a.released.has(stage.id)) {
      a.released.set(stage.id, { releasedAt: iso(now), acknowledgedAt: null })
      letter(a, {
        kind: 'stage',
        stageId: stage.id,
        title: `Видано: ${stage.title}`,
        body: `У списку частин завдання з'явилася **${stage.title}**.`,
      })
    }
  }
  const second = STAGES[1]
  if (a.released.has(second.id) && age >= ERRATA_SEC * 1000 && !a.errata) {
    a.errata = { text: 'Уточнення: такт триває **500 мс**, а не 250.', at: iso(now) }
    letter(a, { title: `Уточнення до частини ${second.position}`, body: a.errata.text })
  }
}

function stageView(a, stage, full) {
  const state = a.released.get(stage.id)
  const errata = stage.position === 2 ? a.errata : null
  const base = {
    id: stage.id,
    position: stage.position,
    title: stage.title,
    publishedAt: stage.publishedAt,
    releasedAt: state.releasedAt,
    acknowledgedAt: state.acknowledgedAt,
    errataAt: errata?.at ?? null,
  }
  return full
    ? { ...base, body: stage.body, errata: errata?.text ?? null }
    : { ...base, excerpt: stage.body.replace(/[#*`[\]()]/g, '').slice(0, 240) }
}

// ---------- accounts ----------

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

function newRepository(slug) {
  return {
    url: `https://github.com/${slug}`,
    accessStatus: 'pending',
    checkedAt: null,
    reason: null,
    reasonCode: null,
    updatedAt: iso(Date.now()),
    verifiedElsewhere: false,
  }
}

function config(phase) {
  return {
    apiVersion: 1,
    title: 'Зоря.нет (локальний стенд)',
    season: 'Зоря 2026',
    registrationOpen: phase === 'window',
    inviteRequired: true,
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
  if (!exactFields(body, ['username', 'displayName', 'password', 'invitation', 'repositoryUrl'], ['lang'])) {
    return fail(400, 'invalid-fields')
  }
  const { username, displayName, password, invitation, repositoryUrl, lang = 'uk' } = body
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
  // Application code: someone else's, used or expired is 422 invalid-invitation (rules of 22.09).
  const code = typeof invitation === 'string' ? invitation.trim() : ''
  if (code !== INVITATION || (CODE_ONCE && usedCodes.has(code))) return fail(422, 'invalid-invitation', 'invitation')
  const repo = parseRepo(repositoryUrl)
  if (repo.code) return fail(422, repo.code, 'repositoryUrl')
  if (accounts.has(username)) return fail(409, 'username-unavailable')

  const now = Date.now()
  const account = {
    id: randomUUID(),
    username,
    displayName,
    password,
    lang,
    createdAt: iso(now),
    repository: newRepository(repo.slug),
    inbox: [],
    released: new Map(),
    errata: null,
  }
  accounts.set(username, account)
  usedCodes.add(code)
  letter(account, {
    title: 'Ви на зв’язку',
    body: `Вас записано в журнал виходу на зв'язок під іменем **${displayName}**. Запросіть \`zoria-net-bot\` і покладіть \`.zoria\`.`,
  })
  advance(account)
  roll.push({ n: roll.length + 1, at: iso(now), sinceOpen: Math.max(0, Math.floor((now - opensAt) / 1000)), name: displayName })
  return { status: 201, body: newSession(account) }
}

function login(body) {
  if (!exactFields(body, ['username', 'password'])) return fail(400, 'invalid-fields')
  const account = accounts.get(String(body.username))
  if (!account || account.password !== body.password) return fail(401, 'invalid-credentials')
  return { status: 200, body: newSession(account) }
}

/** limit 1..100 (default 50), offset 0..1 000 000; null for invalid-query. */
function paging(url) {
  const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 50
  const offset = url.searchParams.has('offset') ? Number(url.searchParams.get('offset')) : 0
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return null
  if (!Number.isInteger(offset) || offset < 0 || offset > 1_000_000) return null
  return { limit, offset }
}

function page(list, p) {
  const items = list.slice(p.offset, p.offset + p.limit)
  return { items, nextOffset: p.offset + p.limit < list.length ? p.offset + p.limit : null }
}

function summary(a) {
  const latest = news.reduce((max, n) => Math.max(max, Date.parse(n.updatedAt), Date.parse(n.publishedAt)), 0)
  return {
    unread: a.inbox.filter((m) => m.readAt === null).length,
    releasedStages: a.released.size,
    acknowledgedStages: [...a.released.values()].filter((s) => s.acknowledgedAt !== null).length,
    latestNews: latest ? iso(latest) : null,
    repositoryAt: a.repository.updatedAt,
    serverTime: iso(Date.now()),
  }
}

const AUTH_ROUTES = /^\/(auth\/logout|me(\/repository|\/summary)?|news|inbox(\/[^/]+(\/read)?)?|stages(\/[^/]+(\/ack)?)?|developer\/check)$/

/**
 * Handles a participant route in the window or after it. Returns null for an
 * unknown route. `lose` is set when the answer should be dropped after the work
 * is done: the client then has to find out by logging in (CL-17).
 */
export function participant({ req, url, method, path, body, phase, opensAt }) {
  if (method === 'GET' && path === '/public/config') return { status: 200, body: config(phase) }

  if (method === 'POST' && (path === '/auth/register' || path === '/auth/login')) {
    if (Math.random() < BUSY) return { ...fail(429, 'authentication-busy'), retryAfter: 5 }
    if (path === '/auth/login') return login(body)
    const result = register(body, phase, opensAt)
    return result.status === 201 && Math.random() < LOSE ? { ...result, lose: true } : result
  }

  if (!AUTH_ROUTES.test(path)) return null
  const a = authorized(req)
  if (!a) return fail(401, 'authentication-required')
  advance(a)
  if (method === 'GET' && path !== '/me' && Math.random() < CABINET_FAIL) return fail(502, 'internal-error')

  if (method === 'POST' && path === '/auth/logout') {
    sessions.delete(req.headers.authorization.slice(7))
    return { status: 204, body: null }
  }
  if (method === 'GET' && path === '/me') return { status: 200, body: { user: publicUser(a) } }
  if (method === 'PATCH' && path === '/me') {
    if (!exactFields(body, ['lang'])) return fail(400, 'invalid-fields')
    if (body.lang !== 'uk' && body.lang !== 'en') return fail(422, 'invalid-field', 'lang')
    a.lang = body.lang
    return { status: 200, body: { user: publicUser(a) } }
  }
  if (method === 'GET' && path === '/me/repository') return { status: 200, body: { repository: { ...a.repository } } }
  if (method === 'PUT' && path === '/me/repository') {
    if (!exactFields(body, ['url'])) return fail(400, 'invalid-fields')
    const repo = parseRepo(body.url)
    if (repo.code) return fail(422, repo.code, 'url')
    a.repository = newRepository(repo.slug)
    return { status: 200, body: { repository: { ...a.repository } } }
  }
  if (method === 'GET' && path === '/me/summary') return { status: 200, body: summary(a) }

  if (method === 'GET' && (path === '/news' || path === '/inbox')) {
    const p = paging(url)
    if (!p) return fail(400, 'invalid-query')
    const list = path === '/news' ? news.filter((n) => n.archivedAt === null) : a.inbox
    return { status: 200, body: page(list, p) }
  }

  const letterMatch = /^\/inbox\/([^/]+)(\/read)?$/.exec(path)
  if (letterMatch) {
    const message = a.inbox.find((m) => m.id === letterMatch[1])
    if (!message) return fail(404, 'not-found')
    if (method === 'POST' && letterMatch[2]) {
      message.readAt ??= iso(Date.now())
      return { status: 200, body: { message } }
    }
    if (method === 'GET' && !letterMatch[2]) return { status: 200, body: { message } }
  }

  if (method === 'GET' && path === '/stages') {
    const items = STAGES.filter((s) => a.released.has(s.id)).map((s) => stageView(a, s, false))
    return { status: 200, body: { items } }
  }
  const stageMatch = /^\/stages\/([^/]+)(\/ack)?$/.exec(path)
  if (stageMatch) {
    const stage = STAGES.find((s) => s.id === stageMatch[1])
    if (!stage || !a.released.has(stage.id)) return fail(404, 'not-found')
    if (method === 'POST' && stageMatch[2]) {
      const state = a.released.get(stage.id)
      state.acknowledgedAt ??= iso(Date.now())
      return { status: 200, body: { stage: stageView(a, stage, true) } }
    }
    if (method === 'GET' && !stageMatch[2]) return { status: 200, body: { stage: stageView(a, stage, true) } }
  }

  if (method === 'POST' && path === '/developer/check') {
    if (!exactFields(body, ['echo']) || typeof body.echo !== 'string' || body.echo.length > 4096) {
      return fail(422, 'invalid-field', 'echo')
    }
    return {
      status: 200,
      body: {
        apiVersion: 1,
        accountId: a.id,
        serverTime: iso(Date.now()),
        echo: body.echo,
        checks: { authenticated: true, json: true, utf8: true },
        summary: summary(a),
      },
    }
  }

  return fail(404, 'not-found')
}

export function invitationCode() {
  return INVITATION
}
