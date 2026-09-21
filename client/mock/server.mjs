// Local stand for client development: the part 1 ether protocol. Frames are
// sealed with a key generated at start that lives only in this process.
// Not the real server: noise shares are guesses, shapes and rules follow the spec.
//
//   node mock/server.mjs            cycle of 10 minutes
//   MOCK_CYCLE_MIN=60 node mock/server.mjs
//
// Cycle, like the stand's hour: 0-50 % static (harbinger from 33 %),
// 50-83 % window, 83-100 % after.

import { createServer } from 'node:http'
import { webcrypto as crypto } from 'node:crypto'

const PORT = Number(process.env.MOCK_PORT ?? 8787)
const CYCLE_MS = Number(process.env.MOCK_CYCLE_MIN ?? 10) * 60_000
const NOISE_SHARE = Number(process.env.MOCK_NOISE ?? 0.6)

const LETTER = [
  'Ви знову стукаєте в ефір, мовці.',
  'Я відкрию його один раз і ненадовго.',
  'Хто почує - назве себе.',
  'Хто проспить - спатиме далі.',
  'Печатку Шум не підробить.',
  'Вірте лише печатці, решта - погода.',
  'Не кричіть у канал.',
  'Говоріть тихіше.',
]

const VOICE = [
  { uk: '...тріск... у шумі несуча... слабка, рівна...', ru: '...треск... в шуме несущая... слабая, ровная...' },
  { uk: '...несуча тримається... хтось на тому боці...', ru: '...несущая держится... кто-то на той стороне...' },
  { uk: '...позивні... ще тихо, але вже чути...', ru: '...позывные... ещё тихо, но уже слышно...' },
  { uk: '...станція на частоті... готуйтеся назвати себе...', ru: '...станция на частоте... готовьтесь назвать себя...' },
]

const b64url = (bytes) => Buffer.from(bytes).toString('base64url')

const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])
const signingKey = pair.privateKey
const rawPublicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
const PUBLIC_KEY = b64url(rawPublicKey)
const FINGERPRINT = Buffer.from(await crypto.subtle.digest('SHA-256', rawPublicKey)).toString('hex')
const KEY_ID = FINGERPRINT.slice(0, 16)

async function seal(frame) {
  const text = JSON.stringify(frame)
  const signature = await crypto.subtle.sign({ name: 'Ed25519' }, signingKey, new TextEncoder().encode(text))
  return { frame: text, seal: b64url(signature), key: KEY_ID }
}

// ---------- schedule ----------

const started = Date.now()

function schedule(now = Date.now()) {
  const cycleStart = started + Math.floor((now - started) / CYCLE_MS) * CYCLE_MS
  const opensAt = cycleStart + CYCLE_MS * 0.5
  const closesAt = cycleStart + CYCLE_MS * (5 / 6)
  const harbingerFrom = cycleStart + CYCLE_MS * (1 / 3)
  const phase = now < opensAt ? 'static' : now < closesAt ? 'window' : 'after'
  return { phase, opensAt, closesAt, harbingerFrom }
}

const iso = (ms) => new Date(ms).toISOString()

const roll = [] // filled by registration later

async function realEnvelope(kind, now = Date.now()) {
  const s = schedule(now)
  const frame = {
    v: 1,
    kind,
    station: 'zoria',
    at: iso(now),
    phase: s.phase,
    window: s.phase === 'static' ? null : { opensAt: iso(s.opensAt), closesAt: iso(s.closesAt) },
    harbinger: null,
    fragment: null,
    onAir: roll.length,
  }
  if (s.phase === 'static' && now >= s.harbingerFrom) {
    const opensIn = Math.max(0, Math.floor((s.opensAt - now) / 1000))
    const share = (s.opensAt - now) / (s.opensAt - s.harbingerFrom)
    frame.harbinger = { opensIn, text: VOICE[Math.min(3, Math.floor((1 - share) * 4))] }
  }
  if (s.phase === 'static' && Math.random() < 0.35) {
    const n = 1 + Math.floor(Math.random() * LETTER.length)
    frame.fragment = { n, of: LETTER.length, text: LETTER[n - 1] }
  }
  if (kind === 'roll') frame.roll = s.phase === 'static' ? [] : roll
  return seal(frame)
}

let lastReal = null

// ---------- noise ----------

const FOREIGN_STATUSES = [200, 201, 204, 400, 401, 403, 404, 409, 410, 418, 422, 500, 502, 504]
const API_CODES = ['repository-not-eligible', 'username-unavailable', 'invalid-field', 'not-found', 'internal-error']
const pick = (list) => list[Math.floor(Math.random() * list.length)]
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function noise(res, status, kind) {
  const variant = pick(['broken', 'forged', 'foreign', 'drop', 'delay', 'echo'])
  const now = Date.now()
  switch (variant) {
    case 'broken': {
      const text = JSON.stringify(await realEnvelope(kind, now))
      return send(res, status, text.slice(0, Math.floor(text.length * Math.random())), 'application/json')
    }
    case 'forged': {
      const real = await realEnvelope(kind, now)
      const fake = JSON.parse(real.frame)
      fake.phase = 'window'
      fake.window = { opensAt: iso(now - 600_000), closesAt: iso(now + 36_000_000) }
      fake.harbinger = null
      return send(res, status, JSON.stringify({ ...real, frame: JSON.stringify(fake) }))
    }
    case 'foreign': {
      const code = pick(FOREIGN_STATUSES)
      const body = pick([
        '',
        'static',
        '<html><body>502 Bad Gateway</body></html>',
        JSON.stringify({ error: { code: pick(API_CODES) } }),
        '[1,2,3]',
      ])
      return send(res, code, code === 204 ? '' : body, body.startsWith('<') ? 'text/html' : 'application/json')
    }
    case 'drop':
      res.socket?.destroy()
      return undefined
    case 'delay': {
      const envelope = await realEnvelope(kind, now)
      await sleep(2_000 + Math.random() * 6_000)
      return send(res, status, JSON.stringify(envelope))
    }
    case 'echo':
      return send(res, status, JSON.stringify(lastReal ?? (await realEnvelope(kind, now - 120_000))))
  }
}

// ---------- ether limit (spec 5.6) ----------

const buckets = new Map()

function limiterFor(ip) {
  let entry = buckets.get(ip)
  if (!entry) {
    entry = { tokens: 20, at: Date.now(), jamUntil: 0, strikes: 0, lastStrike: 0 }
    buckets.set(ip, entry)
  }
  return entry
}

/** null when allowed, else Retry-After seconds. */
function checkLimit(ip) {
  const e = limiterFor(ip)
  const now = Date.now()
  if (e.strikes > 0 && e.jamUntil < now && now - Math.max(e.jamUntil, e.lastStrike) > 600_000) e.strikes = 0
  if (now < e.jamUntil) {
    const left = e.jamUntil - now
    if (left > 1_000) strike(e, now)
    return Math.ceil((e.jamUntil - now) / 1000)
  }
  e.tokens = Math.min(20, e.tokens + (now - e.at) / 3_000)
  e.at = now
  if (e.tokens >= 1) {
    e.tokens -= 1
    return null
  }
  strike(e, now)
  return Math.ceil((e.jamUntil - now) / 1000)
}

function strike(e, now) {
  e.strikes += 1
  e.lastStrike = now
  e.jamUntil = now + Math.min(1_800_000, 30_000 * 2 ** (e.strikes - 1))
}

function counts(method, path, authorized, phase) {
  if (method === 'OPTIONS') return false
  if (['POST /auth/login', 'GET /ether/key', 'GET /openapi.json'].includes(`${method} ${path}`)) return false
  return phase === 'static' ? true : !authorized
}

// ---------- http ----------

let requestNo = 0

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8` })
  res.end(body)
}

function json(res, status, value) {
  send(res, status, JSON.stringify(value))
}

const server = createServer(async (req, res) => {
  requestNo += 1
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Expose-Headers', 'Retry-After, X-Request-Id')
  res.setHeader('X-Request-Id', `mock-${requestNo}`)

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '600',
    })
    res.end()
    return
  }

  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  const path = url.pathname.replace(/^\/api\/v1/, '')
  const method = req.method ?? 'GET'
  const { phase } = schedule()
  const ip = req.socket.remoteAddress ?? 'local'

  if (counts(method, path, Boolean(req.headers.authorization), phase)) {
    const retryAfter = checkLimit(ip)
    if (retryAfter !== null) {
      res.setHeader('Retry-After', String(retryAfter))
      json(res, 429, { error: { code: 'jammed' } })
      log(method, path, 429, 'jammed')
      return
    }
  }

  if (method === 'GET' && path === '/ether/key') {
    json(res, 200, { algorithm: 'Ed25519', key: KEY_ID, publicKey: PUBLIC_KEY, fingerprint: FINGERPRINT })
    return
  }

  if (method === 'GET' && (path === '/ether' || path === '/ether/roll')) {
    const kind = path === '/ether' ? 'signal' : 'roll'
    if (phase === 'static' && Math.random() < NOISE_SHARE) {
      log(method, path, 'noise')
      await noise(res, 200, kind)
      return
    }
    const envelope = await realEnvelope(kind)
    if (kind === 'signal') lastReal = envelope
    json(res, 200, envelope)
    log(method, path, 200, phase)
    return
  }

  if (phase === 'static' && method !== 'POST') {
    if (Math.random() < NOISE_SHARE) await noise(res, 503, 'signal')
    else json(res, 503, await realEnvelope('signal'))
    return
  }

  json(res, 404, { error: { code: 'not-found' } })
})

function log(method, path, ...rest) {
  console.log(new Date().toISOString().slice(11, 19), method, path, ...rest)
}

server.listen(PORT, () => {
  const s = schedule()
  console.log(`mock stand on http://localhost:${PORT}/api/v1, cycle ${CYCLE_MS / 60_000} min`)
  console.log(`phase ${s.phase}; window ${iso(s.opensAt)} .. ${iso(s.closesAt)}`)
  console.log(`station key fingerprint ${FINGERPRINT} (new on every start)`)
})
