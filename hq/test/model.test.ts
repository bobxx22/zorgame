import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BeliefIndex, readDiary } from '../src/model/belief.ts'
import { changesOf, newChanges, pushChange, valueAt } from '../src/model/changes.ts'
import { MatchIndex } from '../src/model/match.ts'
import { compare, comparedPair, readEntry, slotOf, type PackEntry } from '../src/model/pack.ts'
import type { MatchMeta, TruthChunk } from '../src/model/wire.ts'

test('a change list answers any tick with the last change no later than it', () => {
  const c = newChanges<string>()
  pushChange(c, 3, 'a')
  pushChange(c, 5, 'a')
  pushChange(c, 9, 'b')
  assert.deepEqual(c.t, [3, 9])
  assert.equal(valueAt(c, 2), undefined)
  assert.equal(valueAt(c, 3), 'a')
  assert.equal(valueAt(c, 8), 'a')
  assert.equal(valueAt(c, 9), 'b')
  assert.equal(valueAt(c, 1200), 'b')
  assert.equal(valueAt(undefined, 5), undefined)
})

test('a second change in the same tick replaces the first', () => {
  const c = newChanges<number>()
  pushChange(c, 4, 1)
  pushChange(c, 4, 2)
  assert.deepEqual([c.t, c.v], [[4], [2]])
})

test('the change list of a key is made once and found again', () => {
  const map = new Map<string, ReturnType<typeof newChanges<string>>>()
  const first = changesOf(map, '1,1')
  pushChange(first, 2, 'a')
  assert.equal(changesOf(map, '1,1'), first)
  assert.equal(valueAt(changesOf(map, '1,1'), 2), 'a')
  assert.equal(changesOf(map, '2,2').t.length, 0)
  assert.equal(map.size, 2)
})

test('the belief is the last full frame plus the changes after it', () => {
  const diary = [
    { t: 1, full: true, own: { '1,1': 'A', '2,2': null }, dark: { '1,1': false } },
    { t: 5, own: { '2,2': 'B' }, dark: { '1,1': true } },
    { t: 9, own: { '3,3': 'K' } },
  ]
    .map((f) => JSON.stringify(f))
    .join('\n')
  const b = readDiary(diary + '\n')
  assert.equal(b.ownerAt('1,1', 0), undefined)
  assert.equal(b.ownerAt('2,2', 1), null)
  assert.equal(b.ownerAt('2,2', 5), 'B')
  assert.equal(b.ownerAt('3,3', 8), undefined)
  assert.equal(b.ownerAt('3,3', 9), 'K')
  assert.equal(b.darkAt('1,1', 4), false)
  assert.equal(b.darkAt('1,1', 5), true)
  assert.equal(b.last, 9)
  assert.equal(b.skipped, 0)
})

test('a full frame is the whole belief: a needle it does not name leaves the belief', () => {
  const b = new BeliefIndex()
  b.push({ t: 1, full: true, own: { '1,1': 'A', '2,2': 'B' }, dark: { '2,2': true } })
  b.push({ t: 200, full: true, own: { '1,1': 'A' }, dark: {} })
  assert.equal(b.ownerAt('2,2', 199), 'B')
  assert.equal(b.ownerAt('2,2', 200), undefined)
  assert.equal(b.darkAt('2,2', 199), true)
  assert.equal(b.darkAt('2,2', 200), false)
  assert.equal(b.ownerAt('1,1', 200), 'A')
})

test('the memory of a unit is its last contact no later than the tick', () => {
  const b = new BeliefIndex()
  b.push({ t: 10, foe: [['K-1', 'K', 2, 4]] })
  b.push({
    t: 30,
    foe: [
      ['K-1', 'K', 3, 4],
      ['T-B6', 'B', 0, 0],
    ],
  })
  assert.equal(b.contact('K-1', 9), null)
  assert.deepEqual(b.contact('K-1', 29), { t: 10, slot: 'K', q: 2, r: 4 })
  assert.deepEqual(b.contact('K-1', 30), { t: 30, slot: 'K', q: 3, r: 4 })
  assert.equal(b.contact('nobody', 30), null)
  assert.deepEqual(b.unitsSeen(10), ['K-1'])
  assert.deepEqual(b.unitsSeen(30), ['K-1', 'T-B6'])
})

test('a diary line that is not a frame is counted, a line from the past is not placed', () => {
  const b = readDiary('{"t":3,"own":{"1,1":"A"}}\nnot json\n{"no":"tick"}\n{"t":2,"own":{"1,1":"B"}}\n')
  assert.equal(b.skipped, 3)
  assert.equal(b.ownerAt('1,1', 3), 'A')
})

test('a line of the diary comes as text or already parsed; the first reason of an unread one is kept', () => {
  const b = new BeliefIndex()
  b.pushLine('{"t":1,"own":{"1,1":"A"}}')
  b.pushLine({ t: 2, own: { '1,1': 'B' } })
  assert.equal(b.ownerAt('1,1', 1), 'A')
  assert.equal(b.ownerAt('1,1', 2), 'B')
  assert.equal(b.skipped, 0)
  b.pushLine({ own: {} })
  b.pushLine('{"t":')
  assert.equal(b.skipped, 2)
  assert.equal(b.skippedWhy, 'a line without a tick')
})

test('two contacts with a unit in one tick: the later one is the memory', () => {
  const b = new BeliefIndex()
  b.push({
    t: 5,
    foe: [
      ['K-1', 'K', 1, 1],
      ['K-1', 'K', 2, 2],
    ],
  })
  assert.deepEqual(b.contact('K-1', 5), { t: 5, slot: 'K', q: 2, r: 2 })
  assert.deepEqual(b.unitsSeen(4), [])
})

test('the change stamp of the belief moves only on a frame that changed something', () => {
  const b = new BeliefIndex()
  b.push({ t: 1, full: true, own: { '1,1': 'A' } })
  b.push({ t: 2 })
  b.push({ t: 3, own: { '1,1': 'B' } })
  assert.equal(b.changeStamp(1), b.changeStamp(2))
  assert.notEqual(b.changeStamp(2), b.changeStamp(3))
})

const META: MatchMeta = {
  ticks: 10,
  roster: ['ann', 'bob', 'cid'],
  needles: [
    { q: 1, r: 1, start: 'A', ring: false, spoke: false },
    { q: 2, r: 2, start: null, ring: false, spoke: false },
  ],
  radius: 20,
  cells: [],
  types: ['bare'],
  seats: [],
  citadel: { q: 0, r: 0 },
  cherta: 6,
  dawnAt: 8,
  denyWords: ['', 'сміття', 'стеля'],
}

function chunk(from: number, to: number, patch: Partial<TruthChunk> = {}): TruthChunk {
  const n = to - from + 1
  const score = new Float64Array(n * 3)
  const needles = new Uint16Array(n * 3)
  for (let i = 0; i < n; i++) {
    score[i * 3] = (from + i) * 1.5
    needles[i * 3 + 1] = from + i
  }
  return { from, to, score, needles, own: [], lit: [], units: [], frames: [], denies: [], ...patch }
}

test('a match answers a tick only after its truth has arrived', () => {
  const m = new MatchIndex(META)
  assert.equal(m.known(0), false)
  m.addChunk(
    chunk(0, 4, {
      own: [
        [0, '1,1', 'A'],
        [3, '2,2', 'B'],
      ],
      lit: [
        [0, '1,1', true],
        [4, '1,1', false],
      ],
    }),
  )
  assert.equal(m.known(4), true)
  assert.equal(m.known(5), false)
  assert.equal(m.scoreAt(0, 4), 6)
  assert.equal(m.needlesAt(1, 3), 3)
  assert.equal(m.ownerAt('2,2', 2), null)
  assert.equal(m.ownerAt('2,2', 3), 'B')
  assert.equal(m.litAt('1,1', 3), true)
  assert.equal(m.litAt('1,1', 4), false)
  m.addChunk(chunk(5, 10, { own: [[7, '2,2', null]] }))
  assert.equal(m.done, 10)
  assert.equal(m.ownerAt('2,2', 7), null)
  assert.equal(m.scoreAt(0, 10), 15)
})

test('units are on the field from the tick they appear until the tick they are gone', () => {
  const m = new MatchIndex(META)
  m.addChunk(
    chunk(0, 6, {
      units: [
        [2, 'T-A1', 'A', 'ткач', 3, -4, true],
        [4, 'T-A1', 'A', 'ткач', 4, -4, true],
        [6, 'T-A1', '', '', 0, 0, false],
      ],
    }),
  )
  assert.deepEqual(m.unitsAt(1), [])
  assert.deepEqual(m.unitsAt(3), [{ id: 'T-A1', owner: 'A', cls: 'ткач', q: 3, r: -4 }])
  assert.deepEqual(m.unitsAt(5), [{ id: 'T-A1', owner: 'A', cls: 'ткач', q: 4, r: -4 }])
  assert.deepEqual(m.unitsAt(6), [])
  assert.equal(m.changeStamp(2), m.changeStamp(3))
  assert.notEqual(m.changeStamp(3), m.changeStamp(4))
})

test('the channel: bytes, commands, denials with their words and the tick of the peak', () => {
  const m = new MatchIndex(META)
  m.addFrames(
    [
      [3, 0, 25, 2],
      [4, 0, 40, 3],
      [4, 1, 7, 1],
    ],
    10,
  )
  m.addDenies([
    [0, 4, 1, 2],
    [0, 4, 2, 1],
    [0, 7, 0, 2],
    [0, 7, 1, 2],
    [0, 9, 0, 1],
    [1, 2, 0, 1],
  ])
  assert.equal(m.bytesAt(0, 3), 25)
  assert.equal(m.ordersAt(0, 4), 3)
  assert.equal(m.bytesAt(0, 5), 0)
  assert.equal(m.bytesAt(1, 4), 7)
  assert.equal(m.deniesAt(0, 4).length, 2)
  assert.equal(m.denyWord(0, 4, 1), 'стеля')
  assert.equal(m.denyWord(0, 4, 2), 'сміття')
  assert.equal(m.denyWord(0, 4, 0), null)
  /* ticks 4 and 7 share the peak: the smaller tick wins */
  assert.equal(m.denyTopTick(0), 4)
  assert.equal(m.denyTopTick(1), 2)
  assert.equal(m.denyTopTick(2), 0)
  m.addDenies([[0, 7, 2, 1]])
  assert.equal(m.denyTopTick(0), 7)
})

const SLOTS = ['A', 'B', 'C'] as const

/* a pack summary of the hall ann, bob, cid where only the focus's numbers matter */
function entry(id: string, preset: string, seat: number, net: number, inSecond: Record<string, number>): PackEntry {
  const made = readEntry({
    id,
    preset,
    pack: {
      seed: 2027,
      ticks: 1200,
      shares: [7, 5, 6],
      roster: ['ann', 'bob', 'cid'],
      rotations: [
        ['A', 'B', 'C'],
        ['B', 'C', 'A'],
        ['C', 'A', 'B'],
      ],
      breakdown: [0, 1, 2].map((i) => ({ network: i === seat ? net : 1 })),
      matches: [1, 2, 3].map((n) => ({ file: `match-${n}.runlog`, breakdown: { [SLOTS[(seat + n - 1) % 3] ?? 'A']: n === 2 ? inSecond : { total: 0 } } })),
      belief: { seat, files: [] },
    },
  })
  assert.ok(made)
  return made
}

test('two presets of one seed are compared by the summaries of the focus', () => {
  const a = entry('preset-a', 'рівний', 1, 500, { total: 177.2, network: 193.9, orders: 0, stolen: 7, pactTax: 16.7 })
  const b = entry('preset-b', 'обхідник', 1, 480, { total: 164.7, network: 179.9, orders: 30, stolen: 7.1, pactTax: 15.3 })
  assert.equal(slotOf(a.pack, 1, 2), 'C')
  const cmp = compare(a, b, 2)
  assert.equal(cmp.winner, 'preset-a')
  assert.equal(cmp.diff.toFixed(1), '12.5')
  /* orders diverge by 30, more than the 14 of the network */
  assert.equal(cmp.top, 'orders')
  assert.deepEqual(
    cmp.rows.map((r) => r.item),
    ['total', 'network', 'orders', 'stolen', 'pactTax'],
  )
  assert.equal(compare(b, a, 2).winner, 'preset-a')
  /* equal network minutes: the first of the pair */
  assert.equal(compare(a, entry('preset-b', 'обхідник', 1, 500, {}), 1).winner, 'preset-a')
})

test('the compared pair is preset-a and preset-b, or two records of one seed with different presets', () => {
  const ref = entry('reference', 'рівний', 0, 1, {})
  const a = entry('preset-a', 'рівний', 0, 1, {})
  const b = entry('preset-b', 'обхідник', 0, 1, {})
  const mine = entry('mine', 'сплав', 0, 1, {})
  assert.deepEqual(
    comparedPair([ref, a, b])?.map((p) => p.id),
    ['preset-a', 'preset-b'],
  )
  assert.deepEqual(
    comparedPair([ref, mine])?.map((p) => p.id),
    ['reference', 'mine'],
  )
  assert.equal(comparedPair([ref, a]), null)
  assert.equal(readEntry({ id: 'x', pack: { roster: 'no' } }), null)
})
