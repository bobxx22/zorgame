// Parts 3 and 4 of the mock stand: the submission state (GET /me/stack) and one's own
// games with their records (GET /me/games, /me/games/{id}/pack, /me/games/{id}/records/{file}),
// in the shapes of part4/01-submit.md 4.1 and part3/03-record.md 6.1. The data is made up
// and the same for every account, except the account's own name in the pack's roster.
//
//   MOCK_STACK=ok                ok | failed | none: the state of the submission
//   MOCK_BAD_RECORD=             a record file served with one byte flipped, to see the sha256 check fail

import { createHash } from 'node:crypto'

const STACK = process.env.MOCK_STACK ?? 'ok'
const BAD_RECORD = process.env.MOCK_BAD_RECORD ?? ''

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const SHA = 'dd6f7dd3c0a41e5b9d2f7a61c8e04b2f95d3a7e1'
const OLD_SHA = '8a1f04c2b7e95d3361f0a2c4e8b7d9f1a3c5e7b9'
const DIGEST = 'sha256:4f1c9a0e7b3d5c2a8e6f1b0d9c7a5e3f2b4d6a8c0e1f3a5b7c9d0e2f4a6b8c0d'

const STAGES = ['repo', 'secrets', 'nakaz', 'lang', 'stack', 'build', 'up', 'hello', 'health', 'metrics', 'hq-bundle']
const DETAIL = {
  repo: 'дзеркало взято, HEAD зафіксовано',
  secrets: 'знахідок немає',
  nakaz: 'nakaz.yaml прочитано, правил 7',
  lang: 'TypeScript',
  stack: 'compose.yaml: bot, control-plane',
  build: 'образи зібрано за 74 с',
  up: 'стек піднявся за 9 с',
  hello: 'присягу прийнято на такті 0',
  health: '200 за 41 мс',
  metrics: 'zaria_* присутні',
  'hq-bundle': 'штаб не здано (частина 3)',
}

function verdict(id, sha, at, failAt) {
  const checks = []
  for (const name of STAGES) {
    const ok = name !== failAt
    checks.push({ name, ok, detail: ok ? DETAIL[name] : 'src/old.test.ts:12: схоже на пароль у відкритому вигляді' })
    if (!ok) break
  }
  return { id, sha, digest: failAt ? '' : DIGEST, at, ok: !failAt, checks }
}

export function stackOf() {
  const green = verdict('v-2', SHA, '2026-10-07T03:21:40Z', null)
  const red = verdict('v-1', OLD_SHA, '2026-10-06T21:02:13Z', 'secrets')
  const history = STACK === 'none' ? [] : STACK === 'failed' ? [red] : [green, red]
  return {
    status: STACK,
    latest: history[0] ?? null,
    history,
    nextGameAt: '2026-10-11T21:40:00Z',
    submit: {
      window: { id: 'group', title: 'груповий етап', freezeAt: '2026-10-09T21:00:00Z', retryUntil: '2026-10-10T21:00:00Z', phase: 'ahead' },
      submissions: [],
      retry: { available: false, used: false, until: '2026-10-10T21:00:00Z' },
    },
  }
}

/* ===== games ===== */

/* a record's bytes: ndjson lines that look like a journal or a diary, deterministic per file */
function recordBytes(file, lines) {
  const out = [JSON.stringify({ file })]
  for (let t = 0; t < lines; t++) {
    out.push(JSON.stringify(file.startsWith('belief') ? { t, belief: { rivals: 2, hearths: [t % 7, (t * 3) % 11] } } : { t, slot: 'ABC'[t % 3], orders: (t * 7) % 5 }))
  }
  return Buffer.from(out.join('\n') + '\n', 'utf8')
}

const FILES = [
  ['match-1.runlog', 'журнал', 2400, false],
  ['match-2.runlog', 'журнал', 2400, false],
  ['match-3.runlog', 'журнал', 2400, false],
  ['belief-1.ndjson', 'щоденник', 1200, true],
  ['belief-2.ndjson', 'щоденник', 1200, true],
  ['belief-3.ndjson', 'щоденник', 1200, true],
].map(([file, kind, lines, mine]) => {
  const bytes = recordBytes(file, lines)
  return { file, kind, mine, bytes, sha256: sha256(bytes) }
})

const PLAYED = 'training-0710'
const SCHEDULED = 'group-1-r1'

function packSummary(a) {
  const score = (x, y, z) => ({ A: x, B: y, C: z })
  return {
    seed: 7101,
    ticks: 1200,
    shares: [9, 5, 4],
    shareParts: [
      [3, 3, 3],
      [2, 1, 2],
      [1, 2, 1],
    ],
    absent: [
      [false, false, false],
      [false, false, false],
      [false, false, false],
    ],
    breakdown: [{ total: 1497.2 }, { total: 1102.6 }, { total: 988.1 }],
    rotations: [
      ['A', 'B', 'C'],
      ['B', 'C', 'A'],
      ['C', 'A', 'B'],
    ],
    roster: [a.username, 'обхідник', 'рівний'],
    matches: FILES.slice(0, 3).map((f, i) => ({
      file: f.file,
      bytes: f.bytes.length,
      sha256: f.sha256,
      score: [score(504.4, 371.2, 330.5), score(349.7, 488.9, 318.0), score(380.3, 300.1, 501.6)][i],
      breakdown: {},
    })),
  }
}

export function gamesOf() {
  return {
    items: [
      { id: SCHEDULED, at: '2026-10-11T21:40:00Z', round: 1, group: 'В', opponents: ['уранішній-вітер', 'kvitka'], result: null },
      { id: PLAYED, at: '2026-10-07T08:03:00Z', title: 'тренувальний день', opponents: [{ nick: 'обхідник' }, { nick: 'рівний' }], result: { share: 9, shares: [9, 5, 4] } },
    ],
  }
}

export function packOf(a, id) {
  if (id === SCHEDULED) return { pack: null, records: [] }
  if (id !== PLAYED) return null
  return {
    pack: packSummary(a),
    records: FILES.map((f) => ({ file: f.file, bytes: f.bytes.length, sha256: f.sha256, receivedAt: '2026-10-07T08:31:12Z', kind: f.kind, mine: f.mine })),
  }
}

/** The bytes of one record, or null; a MOCK_BAD_RECORD file comes with one byte flipped. */
export function recordOf(id, file) {
  if (id !== PLAYED) return null
  const f = FILES.find((x) => x.file === file)
  if (!f) return null
  if (file !== BAD_RECORD) return { bytes: f.bytes, etag: f.sha256 }
  const bad = Buffer.from(f.bytes)
  bad[0] ^= 1
  return { bytes: bad, etag: f.sha256 }
}
