import { describe, expect, it } from 'vitest'
import { parseGames, parsePackView, parseStack } from './submission'

describe('parseStack', () => {
  const answer = {
    status: 'ok',
    latest: { id: 'v-2', sha: 'dd6f7dd', digest: 'sha256:4f1c', at: '2026-10-07T03:21:40Z', ok: true, checks: [{ name: 'repo', ok: true, detail: 'ok' }, { name: 'secrets', ok: true }] },
    history: [{ id: 'v-2', sha: 'dd6f7dd', ok: true, checks: [] }, 'noise', { id: 'v-1', sha: '8a1f04c', ok: false, checks: [{ name: 'secrets', ok: false, detail: 'a password' }] }],
    nextGameAt: '2026-10-11T21:40:00Z',
    submit: {
      window: { id: 'group', title: 'груповий етап', freezeAt: '2026-10-09T21:00:00Z', retryUntil: '2026-10-10T21:00:00Z', phase: 'ahead' },
      submissions: [{ kind: 'retry', auto: true, requestedAt: '2026-10-10T20:59:00Z', sha: null, state: 'queued' }],
      retry: { available: true, used: false, until: '2026-10-10T21:00:00Z' },
    },
  }

  it('reads the documented answer of part 4, 4.1', () => {
    const stack = parseStack(answer)
    expect(stack?.status).toBe('ok')
    expect(stack?.latest?.checks).toEqual([
      { name: 'repo', ok: true, detail: 'ok' },
      { name: 'secrets', ok: true, detail: '' },
    ])
    expect(stack?.history.map((v) => v.ok)).toEqual([true, false])
    expect(stack?.window?.phase).toBe('ahead')
    expect(stack?.submissions[0]).toEqual({ kind: 'retry', auto: true, requestedAt: '2026-10-10T20:59:00Z', sha: null, state: 'queued' })
    expect(stack?.retry).toEqual({ available: true, used: false, until: '2026-10-10T21:00:00Z' })
  })

  it('takes a submission without a verdict yet and refuses an answer without a status', () => {
    expect(parseStack({ status: 'none', latest: null })).toMatchObject({ latest: null, history: [], window: null, retry: null })
    expect(parseStack({ latest: null })).toBeNull()
    expect(parseStack([])).toBeNull()
  })
})

describe('parseGames', () => {
  it('reads a list as an array, {items} or {games}, and counts what it could not read', () => {
    const game = { id: 'g1', at: '2026-10-07T08:03:00Z', opponents: ['обхідник', 'рівний'] }
    expect(parseGames([game])?.items).toHaveLength(1)
    expect(parseGames({ items: [game, { at: 'no id' }] })).toMatchObject({ skipped: 1 })
    expect(parseGames({ games: [game] })?.items[0]?.opponents).toEqual(['обхідник', 'рівний'])
    expect(parseGames({ nothing: [] })).toBeNull()
  })

  it('reads the answer of the network: a played pack and one whose hour is not named yet', () => {
    const answer = {
      items: [
        {
          id: 'c2076e48',
          round: 'training',
          roundTitle: 'Тренування',
          lane: 3,
          seq: 3,
          group: 0,
          startsAt: '2026-10-07T05:03:00.000Z',
          endsAt: '2026-10-07T05:43:00.000Z',
          state: 'played',
          seat: 0,
          triple: ['own', 'zoria-obkhidnyk', 'zoria-rivnyi'],
          opponents: [
            { member: 'zoria-obkhidnyk', username: 'zoria-obkhidnyk', displayName: 'Обхідник' },
            { member: 'zoria-rivnyi', username: 'zoria-rivnyi', displayName: 'Рівний' },
          ],
          result: { shares: [9, 5, 4], share: 9, absent: [0, 0, 0], seed: 1281353795, ticks: 1200, pack: 'g0-p3-1281353795', records: 3 },
          decision: null,
        },
        {
          id: '10a2bc3d',
          round: 'group',
          roundTitle: 'Груповий етап',
          lane: 0,
          seq: 3,
          group: 0,
          startMin: 120,
          startsAt: null,
          endsAt: null,
          state: 'scheduled',
          seat: 2,
          triple: ['kvitka', 'viter', 'own'],
          opponents: [
            { member: 'kvitka', username: 'kvitka', displayName: 'kvitka' },
            { member: 'viter', username: 'viter', displayName: 'Ранковий вітер' },
          ],
          result: null,
          decision: null,
        },
      ],
      serverTime: '2026-10-11T23:36:07.927Z',
    }
    const parsed = parseGames(answer)
    expect(parsed?.raw).toBe(answer)
    expect(parsed?.skipped).toBe(0)
    /* groups and lanes are counted from 0 in the answer and from 1 in letters and in the schedule */
    expect(parsed?.items[0]).toMatchObject({
      id: 'c2076e48',
      at: '2026-10-07T05:03:00.000Z',
      title: 'Тренування, група 1, доріжка 4',
      state: 'played',
      opponents: ['Обхідник (zoria-obkhidnyk)', 'Рівний (zoria-rivnyi)'],
      result: 'частка 9, частки 9 / 5 / 4',
    })
    expect(parsed?.items[1]).toMatchObject({
      at: null,
      title: 'Груповий етап, група 1, доріжка 1',
      state: 'scheduled',
      opponents: ['kvitka', 'Ранковий вітер (viter)'],
      result: '',
    })
  })

  it('names the game, the rivals and the result from differently named fields', () => {
    const [row] = parseGames([{ gameId: 7, startedAt: '2026-10-11T21:40:00Z', round: 1, group: 'В', rivals: [{ nick: 'kvitka' }, { login: 'вітер' }], result: { share: 9, shares: [9, 5, 4] } }])?.items ?? []
    expect(row).toMatchObject({ id: '7', at: '2026-10-11T21:40:00Z', title: 'коло 1, група В', opponents: ['kvitka', 'вітер'], result: 'частка 9, частки 9 / 5 / 4' })
    const [placed] = parseGames([{ id: 'g2', title: 'тренування', place: 1 }])?.items ?? []
    expect(placed).toMatchObject({ title: 'тренування', result: 'місце 1', at: null })
  })
})

describe('parsePackView', () => {
  const pack = {
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
      [false, true, false],
      [false, false, false],
    ],
    rotations: [
      ['A', 'B', 'C'],
      ['B', 'C', 'A'],
      ['C', 'A', 'B'],
    ],
    roster: ['own', 'обхідник', 'рівний'],
    matches: [{ file: 'match-1.runlog', score: { A: 504.4, B: 371.2, C: 330.5 } }],
  }
  const records = [
    { file: 'match-1.runlog', bytes: 78090, sha256: 'ab'.repeat(32), receivedAt: '2026-10-07T08:31:12Z', kind: 'журнал', mine: false },
    { file: 'belief-1.ndjson', bytes: 57799, sha256: 'cd'.repeat(32), kind: 'щоденник', mine: true },
    { bytes: 1 },
  ]

  it('reads the summary in the form of pack.json and the list of records', () => {
    const view = parsePackView({ pack, records })
    expect(view?.pack).toMatchObject({ shares: [9, 5, 4], roster: ['own', 'обхідник', 'рівний'], seed: 7101, ticks: 1200 })
    expect(view?.pack?.shareParts[1]).toEqual([2, 1, 2])
    expect(view?.pack?.absent[1]?.[1]).toBe(true)
    expect(view?.pack?.matches[0]?.score.A).toBe(504.4)
    expect(view?.records.map((r) => [r.file, r.mine])).toEqual([
      ['match-1.runlog', false],
      ['belief-1.ndjson', true],
    ])
    expect(view?.records[1]?.receivedAt).toBeNull()
  })

  it('reads the answer of the network: the summary under `summary`, the name of the pack under `pack`', () => {
    const wire = [
      [{ missed: 1, unsent: 0, garbage: 0 }, { missed: 0 }, { missed: 2 }],
      [{ missed: 967, badResume: 1 }, {}, {}],
      [{}, {}, {}],
    ]
    const view = parsePackView({ gameId: 'c6b81b74', round: 'group', group: 0, pack: 'g0-p0-1132745504', seat: 0, summary: { ...pack, wire }, records, decision: null })
    expect(view?.pack?.shares).toEqual([9, 5, 4])
    expect(view?.summary).toMatchObject({ seed: 7101, wire })
    /* only what the node counted: a clean seat has no counters */
    expect(view?.pack?.wire[0]).toEqual([{ missed: 1 }, {}, { missed: 2 }])
    expect(view?.pack?.wire[1]?.[0]).toEqual({ missed: 967, badResume: 1 })
    expect(view?.records).toHaveLength(2)
  })

  it('takes the summary at the top level, under summary, or not at all', () => {
    expect(parsePackView({ ...pack, files: records })?.pack?.shares).toEqual([9, 5, 4])
    expect(parsePackView({ summary: pack })?.records).toEqual([])
    expect(parsePackView({ pack: null, records: [] })).toMatchObject({ pack: null, records: [] })
    expect(parsePackView('pack')).toBeNull()
  })
})
