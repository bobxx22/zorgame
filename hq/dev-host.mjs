/* a show host for the desk: the kit's own host page with the built show in its
   sandbox, fed with the records from ./records (npx zaria-kit records)

     npm run build && npm run host            a record: http://localhost:8790/host/
     npm run host -- --live 2                 match 2 of the reference record as a broadcast
     npm run host -- --tempo 500              the broadcast at the node's own tempo (25 ms by default)

   The same frame, sandbox and headers as at acceptance (HQ contract, 6.2): what
   opens here opens there. Nothing of this goes into the built show. */

import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readRunLog } from '@zoria/protocol'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.HQ_HOST_PORT ?? 8790)
const RECORDS = resolve(HERE, 'records')
/* HQ_SHOW=records/hq-ref.html puts another bundle into the frame: the reference, to compare frames */
const SHOW_FILE = resolve(HERE, process.env.HQ_SHOW ?? join('dist', 'index.html'))
const SHOW = dirname(SHOW_FILE)
const HOST = resolve(dirname(createRequire(import.meta.url).resolve('@zoria/kit/package.json')), 'hq')

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf('--' + name)
  return i < 0 ? null : (args[i + 1] ?? '')
}
const liveMatch = flag('live') === null ? 0 : Math.max(1, Math.min(3, Number(flag('live')) || 1))
const tempoMs = Number(flag('tempo') ?? 25) || 25
const lang = flag('lang') === 'en' ? 'en' : 'uk'

/* the sandbox policy of acceptance and broadcast (HQ contract, 1.2) */
const SHOW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' blob: data:",
  "style-src 'unsafe-inline' data:",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  'worker-src blob: data:',
  'child-src blob: data:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.ndjson': 'application/x-ndjson; charset=utf-8' }

function packs() {
  if (!existsSync(RECORDS)) return []
  const out = []
  for (const id of readdirSync(RECORDS).sort((a, b) => Number(b === 'reference') - Number(a === 'reference') || a.localeCompare(b))) {
    const file = join(RECORDS, id, 'pack.json')
    if (!existsSync(file)) continue
    const preset = id === 'preset-b' ? 'обхідник' : 'рівний'
    out.push({ id, title: id + ' · ' + preset, preset, pack: JSON.parse(readFileSync(file, 'utf8')) })
  }
  return out
}

/* one match of the reference record as the feed of a broadcast: what the journal holds, tick by tick */
function liveFeed(n) {
  const dir = join(RECORDS, 'reference')
  const pack = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8'))
  const log = readRunLog(new Uint8Array(readFileSync(join(dir, pack.matches[n - 1].file))))
  const b64 = (bytes) => Buffer.from(bytes).toString('base64')
  const rows = Array.from({ length: pack.ticks }, () => ({ submits: [], denies: [], episodes: [], belief: null }))
  for (const [t, slot, frame] of log.submits) if (t >= 1 && t <= pack.ticks) rows[t - 1].submits.push([slot, b64(frame)])
  for (const [slot, t, i, code] of log.denies ?? []) if (t >= 1 && t <= pack.ticks) rows[t - 1].denies.push([slot, i, code])
  const seat = pack.belief ? pack.belief.seat : 0
  if (pack.belief) {
    for (const line of readFileSync(join(dir, pack.belief.files[n - 1]), 'utf8').split('\n')) {
      if (!line) continue
      const frame = JSON.parse(line)
      if (frame.t >= 1 && frame.t <= pack.ticks) rows[frame.t - 1].belief = frame
    }
  }
  return {
    manifest: b64(log.manifest),
    bots: log.bots,
    roster: log.roster,
    ticks: pack.ticks,
    seat: ['A', 'B', 'C'].indexOf(pack.rotations[n - 1][seat]),
    shares: pack.shareParts.map((parts) => parts[n - 1]),
    ticksData: rows,
  }
}

function config() {
  const all = packs()
  return JSON.stringify({
    lang,
    mode: liveMatch ? 'live' : 'record',
    hq: '/hq/' + basename(SHOW_FILE),
    files: '/records/',
    packs: all,
    promote: { answers: [{ status: 200 }, { status: 409 }] },
    live: liveMatch ? { tempoMs, feed: liveFeed(liveMatch) } : null,
  })
}

const MOUNTS = [
  { prefix: '/host/', root: HOST, index: 'host.html' },
  { prefix: '/hq/', root: SHOW, index: 'index.html', csp: SHOW_CSP },
  { prefix: '/records/', root: RECORDS, index: '' },
]

function fileFor(url) {
  for (const m of MOUNTS) {
    if (!url.startsWith(m.prefix)) continue
    const rel = decodeURIComponent(url.slice(m.prefix.length)) || m.index
    if (rel.split(/[\\/]/).includes('..')) return null
    const full = resolve(m.root, rel)
    if (!full.startsWith(m.root + sep) || !existsSync(full) || !statSync(full).isFile()) return null
    return { full, csp: m.csp }
  }
  return null
}

const server = createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0]
  if (url === '/') {
    res.writeHead(302, { location: '/host/' })
    res.end()
    return
  }
  if (url === '/host/config.json') {
    res.writeHead(200, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' })
    res.end(config())
    return
  }
  const hit = fileFor(url)
  if (!hit) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('no such file: ' + url)
    return
  }
  const headers = { 'content-type': TYPES[extname(hit.full).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' }
  if (hit.csp) headers['content-security-policy'] = hit.csp
  res.writeHead(200, headers)
  createReadStream(hit.full).pipe(res)
})

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write('show host: http://localhost:' + PORT + '/host/  (' + (liveMatch ? 'broadcast of match ' + liveMatch : 'record') + ', ' + packs().length + ' records)\n')
  if (!existsSync(SHOW_FILE)) process.stdout.write('the show is not built yet: npm run build\n')
  if (packs().length === 0) process.stdout.write('no records in ' + RECORDS + ': npx zaria-kit records\n')
})
