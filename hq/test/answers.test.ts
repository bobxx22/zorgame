import assert from 'node:assert/strict'
import { test } from 'node:test'
import { answers, cellKey, fixed1, type Sources, type View } from '../src/app/answers.ts'
import { BeliefIndex } from '../src/model/belief.ts'
import { MatchIndex } from '../src/model/match.ts'
import { readEntry, type PackEntry } from '../src/model/pack.ts'
import type { MatchMeta } from '../src/model/wire.ts'

const META: MatchMeta = {
  ticks: 20,
  /* the journal's hall of match 2: slot A is cid, B is ann, C is bob */
  roster: ['cid', 'ann', 'bob'],
  needles: [
    { q: 1, r: 1, start: 'A', ring: false, spoke: false },
    { q: 2, r: 2, start: null, ring: false, spoke: false },
    { q: 3, r: 3, start: null, ring: true, spoke: false },
  ],
  radius: 20,
  cells: [],
  types: ['bare'],
  seats: [],
  citadel: { q: 0, r: 0 },
  cherta: 6,
  dawnAt: 15,
  denyWords: ['', 'сміття', 'стеля', 'машина'],
}

function pack(id: string, net: number): PackEntry {
  const made = readEntry({
    id,
    title: id,
    preset: id === 'preset-b' ? 'обхідник' : 'рівний',
    pack: {
      seed: 7,
      ticks: 20,
      shares: [6, 5, 7],
      roster: ['ann', 'bob', 'cid'],
      rotations: [
        ['A', 'B', 'C'],
        ['B', 'C', 'A'],
        ['C', 'A', 'B'],
      ],
      breakdown: [{ network: net }, { network: 0 }, { network: 0 }],
      matches: [1, 2, 3].map((n) => ({ file: `match-${n}.runlog`, breakdown: { B: { total: net / 10, network: net / 10, orders: 0, stolen: 1, pactTax: 2 } } })),
      belief: { seat: 0, files: ['belief-1.ndjson', 'belief-2.ndjson', 'belief-3.ndjson'] },
    },
  })
  assert.ok(made)
  return made
}

/* match 2 of the pack: ann holds slot B */
function match(): MatchIndex {
  const m = new MatchIndex(META)
  const score = new Float64Array(63)
  const needles = new Uint16Array(63)
  for (let t = 0; t <= 20; t++) {
    score[t * 3 + 1] = t * 1.26
    needles[t * 3 + 1] = Math.floor(t / 4)
  }
  m.addChunk({
    from: 0,
    to: 20,
    score,
    needles,
    own: [
      [0, '1,1', 'B'],
      [6, '2,2', 'A'],
      [9, '3,3', 'K'],
    ],
    lit: [],
    units: [],
    frames: [],
    denies: [],
  })
  m.addFrames([[10, 1, 31, 4]], 20)
  m.addDenies([
    [1, 10, 2, 3],
    [1, 10, 3, 2],
    [1, 14, 0, 1],
  ])
  return m
}

function belief(): BeliefIndex {
  const b = new BeliefIndex()
  b.push({ t: 1, full: true, own: { '1,1': 'B', '2,2': null }, dark: { '1,1': false, '2,2': true } })
  b.push({ t: 7, foe: [['K-4', 'K', 2, 4]] })
  return b
}

const VIEW: View = { packId: 'reference', match: 2, tick: 10, mode: 'truth', focus: 'ann', cell: '2,2', unit: 'K-4', order: 2, promote: '-', live: null }

function sources(over: Partial<Sources> = {}): Sources {
  const ref = pack('reference', 100)
  return { packs: [ref, pack('preset-a', 300), pack('preset-b', 420)], pack: ref, index: match(), belief: belief(), ...over }
}

test('a record: every anchor of the contract has its value at the tick', () => {
  assert.deepEqual(answers(VIEW, sources()), {
    tick: '10',
    match: '2',
    mode: 'truth',
    focus: 'ann',
    cell: '2,2',
    /* slot A of match 2 is cid; the bot still believes the needle is nobody's */
    'cell-owner-truth': 'cid',
    'cell-owner-belief': '-',
    'ghost-cell': '2,4',
    'ghost-age': '3',
    /* 2,2 diverges; 3,3 is not in the belief and is not counted */
    'diff-count': '1',
    'dark-count': '1',
    score: '12.6',
    needles: '2',
    shares: '6,5,7',
    bytes: '31',
    orders: '4',
    denied: '2',
    'deny-word': 'машина',
    'deny-top-tick': '10',
    'ab-winner': 'preset-b',
    'ab-diff': '12.0',
    'ab-top': 'network',
    'promote-status': '-',
    'live-lag': '-',
    'live-state': '-',
  })
})

test('the words of the contract: the Keeper, an accepted command, a needle the belief does not know', () => {
  const got = answers({ ...VIEW, cell: ' 3, 3 ', order: 0, unit: 'K-9' }, sources())
  assert.equal(got.cell, '3,3')
  assert.equal(got['cell-owner-truth'], 'K')
  assert.equal(got['cell-owner-belief'], '?')
  assert.equal(got['deny-word'], '-')
  assert.equal(got['ghost-cell'], '-')
  assert.equal(got['ghost-age'], '-')
  assert.equal(answers({ ...VIEW, tick: 5, cell: '2,2' }, sources())['cell-owner-truth'], '-')
})

test('nothing is shown for what has not been read yet', () => {
  const waiting = answers(VIEW, sources({ index: null, belief: null }))
  for (const name of ['cell-owner-truth', 'cell-owner-belief', 'ghost-cell', 'diff-count', 'dark-count', 'score', 'needles', 'bytes', 'deny-top-tick'] as const) {
    assert.equal(waiting[name], '', name)
  }
  assert.equal(waiting.tick, '10')
  assert.equal(waiting.shares, '6,5,7')
  assert.equal(waiting['ab-winner'], 'preset-b')

  /* the truth has reached tick 8 only: the channel is known from the journal, the world is not */
  const short = new MatchIndex(META)
  short.addChunk({ from: 0, to: 8, score: new Float64Array(27), needles: new Uint16Array(27), own: [], lit: [], units: [], frames: [], denies: [] })
  short.addFrames([[10, 1, 31, 4]], 20)
  const partial = answers(VIEW, sources({ index: short }))
  assert.equal(partial.score, '')
  assert.equal(partial['diff-count'], '')
  assert.equal(partial['dark-count'], '1')
  assert.equal(partial.bytes, '31')
})

test('the diary belongs to one participant: another focus has no belief in the record', () => {
  const got = answers({ ...VIEW, focus: 'bob' }, sources())
  assert.equal(got['cell-owner-belief'], '?')
  assert.equal(got['ghost-cell'], '-')
  assert.equal(got['diff-count'], '')
  /* bob holds slot C in match 2 */
  assert.equal(got.score, '0.0')
})

test('a broadcast: the match has no number, the lag is counted from the cap, the shares come at the end', () => {
  const live = { cap: 12, ended: false, shares: null, roster: ['cid', 'ann', 'bob'], owner: 'ann' }
  const on = answers({ ...VIEW, live }, sources({ pack: null }))
  assert.equal(on.match, '-')
  assert.equal(on['live-lag'], '2')
  assert.equal(on['live-state'], 'live')
  assert.equal(on.shares, '')
  assert.equal(on.score, '12.6')
  const over = answers({ ...VIEW, tick: 12, live: { ...live, ended: true, shares: [2, 3, 1] } }, sources({ pack: null }))
  assert.equal(over['live-state'], 'end')
  assert.equal(over['live-lag'], '0')
  assert.equal(over.shares, '2,3,1')
})

test('a cell is two integers; a score is rounded to one digit the way the key is', () => {
  assert.equal(cellKey('3,-10'), '3,-10')
  assert.equal(cellKey('03 , -010'), '3,-10')
  assert.equal(cellKey('3;4'), '')
  assert.equal(cellKey(''), '')
  assert.equal(fixed1(31.649), '31.6')
  assert.equal(fixed1(0), '0.0')
  assert.equal(fixed1(128.05), (Math.round(128.05 * 10) / 10).toFixed(1))
})
