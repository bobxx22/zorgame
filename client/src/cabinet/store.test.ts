import { describe, expect, it } from 'vitest'
import { ApiClient } from '../api/client'
import { FakeClock, json, scriptedFetch } from '../api/testing'
import { FRAME_A } from '../ether/fixtures'
import { CabinetStore, SUMMARY_INTERVAL_MS, UNKNOWN_PHASE_INTERVAL_MS, type AuthCall } from './store'

const BASE = 'https://stand.zoria.net/api/v1'
const T = '2026-09-24T09:00:00.000Z'

const summary = (patch: Record<string, unknown> = {}) => ({
  unread: 1,
  releasedStages: 1,
  acknowledgedStages: 0,
  latestNews: T,
  repositoryAt: T,
  serverTime: T,
  ...patch,
})
const message = (id: string, readAt: string | null = null) => ({
  id,
  messageId: null,
  stageId: null,
  kind: 'message',
  title: `Лист ${id}`,
  body: '**Вітаємо**',
  createdAt: T,
  readAt,
  notice: { type: 'repository', url: 'https://github.com/a/b', accessStatus: 'pending', reason: null, reasonCode: null },
})
const news = (id: string) => ({ id, title: 'Новина', body: 'Текст', createdAt: T, updatedAt: T, publishedAt: T })
const stageSummary = (id: string, errataAt: string | null = null) => ({
  id,
  position: 2,
  title: 'Частина 2',
  excerpt: 'Правила гри',
  publishedAt: T,
  releasedAt: T,
  acknowledgedAt: null,
  errataAt,
})
const stage = (id: string, errata: string | null = null, errataAt: string | null = null) => ({
  ...stageSummary(id, errataAt),
  body: '# Правила',
  errata,
})
const repository = {
  url: 'https://github.com/bobxx22/zorgame',
  accessStatus: 'pending',
  checkedAt: null,
  reason: null,
  reasonCode: null,
  updatedAt: T,
  verifiedElsewhere: false,
}

function setup(replies: Parameters<typeof scriptedFetch>[1]) {
  const clock = new FakeClock(0)
  const { fetch, calls } = scriptedFetch(clock, replies)
  const api = new ApiClient(BASE, { clock, fetch, random: () => 0 })
  api.limiter.setPhase('window')
  const call: AuthCall = (options) => api.call({ ...options, token: 'T' })
  const store = new CabinetStore({ call, clock, random: () => 0 })
  store.setPhase('window')
  const paths = () => calls.map((c) => `${c.init.method ?? 'GET'} ${c.url.slice(BASE.length)}`)
  return { store, paths }
}

const firstLoad = () => [
  json(200, summary()),
  json(200, { items: [message('m1')], nextOffset: null }),
  json(200, { items: [stageSummary('s2')] }),
  json(200, { items: [news('n1')], nextOffset: null }),
  json(200, { repository }),
]

describe('CabinetStore', () => {
  it('loads everything on the first summary', async () => {
    const { store, paths } = setup(firstLoad())
    expect(await store.tick()).toBe(SUMMARY_INTERVAL_MS)
    expect(paths()).toEqual([
      'GET /me/summary',
      'GET /inbox?limit=100&offset=0',
      'GET /stages',
      'GET /news?limit=100&offset=0',
      'GET /me/repository',
    ])
    const s = store.getSnapshot()
    expect(s.inbox?.map((m) => m.id)).toEqual(['m1'])
    expect(s.inbox?.[0]?.notice?.type).toBe('repository')
    expect(s.stages?.map((x) => x.id)).toEqual(['s2'])
    expect(s.news?.map((n) => n.id)).toEqual(['n1'])
    expect(s.repository?.accessStatus).toBe('pending')
  })

  it('rereads only what moved in the summary (CL-27)', async () => {
    const { store, paths } = setup([
      ...firstLoad(),
      json(200, summary()),
      json(200, summary({ latestNews: '2026-09-24T10:00:00.000Z' })),
      json(200, { items: [news('n2'), news('n1')], nextOffset: null }),
      json(200, summary({ latestNews: '2026-09-24T10:00:00.000Z', releasedStages: 2 })),
      json(200, { items: [stageSummary('s2')] }),
      json(200, summary({ latestNews: '2026-09-24T10:00:00.000Z', releasedStages: 2, repositoryAt: '2026-09-24T11:00:00.000Z' })),
      json(200, { repository: { ...repository, accessStatus: 'verified' } }),
    ])
    for (let i = 0; i < 5; i += 1) await store.tick()
    expect(paths().slice(5)).toEqual([
      'GET /me/summary',
      'GET /me/summary',
      'GET /news?limit=100&offset=0',
      'GET /me/summary',
      'GET /stages',
      'GET /me/summary',
      'GET /me/repository',
    ])
    expect(store.getSnapshot().repository?.accessStatus).toBe('verified')
  })

  it('rereads a list whose reread failed on the next poll, not only when the summary moves again', async () => {
    const { store, paths } = setup([
      ...firstLoad(),
      json(200, summary({ releasedStages: 2 })),
      json(502, { error: { code: 'internal-error' } }),
      json(502, { error: { code: 'internal-error' } }),
      json(200, summary({ releasedStages: 2 })),
      json(200, { items: [stageSummary('s2'), { ...stageSummary('s3'), position: 3 }] }),
      json(200, summary({ releasedStages: 2 })),
    ])
    for (let i = 0; i < 4; i += 1) await store.tick()
    expect(paths().slice(5)).toEqual([
      'GET /me/summary',
      'GET /stages',
      'GET /stages',
      'GET /me/summary',
      'GET /stages',
      'GET /me/summary',
    ])
    expect(store.getSnapshot().stages?.map((s) => s.id)).toEqual(['s2', 's3'])
  })

  it('keeps asking for a list that never loaded the first time', async () => {
    const { store } = setup([
      json(200, summary()),
      new TypeError('reset'),
      new TypeError('reset'),
      json(200, { items: [stageSummary('s2')] }),
      json(200, { items: [news('n1')], nextOffset: null }),
      json(200, { repository }),
      json(200, summary()),
      json(200, { items: [message('m1')], nextOffset: null }),
      json(200, { items: [stageSummary('s2')] }),
    ])
    await store.tick()
    expect(store.getSnapshot().inbox).toBeNull()
    await store.tick()
    expect(store.getSnapshot().inbox?.map((m) => m.id)).toEqual(['m1'])
  })

  it('asks nothing while the station is in static', async () => {
    const { store, paths } = setup([])
    store.setPhase('static')
    await store.tick()
    expect(paths()).toEqual([])
    expect(store.getSnapshot().noise).toBe(true)
  })

  it('does not call an envelope without a valid seal the station in static (CL-02)', async () => {
    const clock = new FakeClock(0)
    const { fetch } = scriptedFetch(clock, [json(503, JSON.parse(FRAME_A))])
    const api = new ApiClient(BASE, { clock, fetch, random: () => 0 })
    api.limiter.setPhase('window')
    const store = new CabinetStore({
      call: (options) => api.call({ ...options, token: 'T' }),
      hear: () => Promise.resolve(false),
      clock,
      random: () => 0,
    })
    store.setPhase('window')
    await store.tick()
    expect(store.getSnapshot().noise).toBe(false)
  })

  it('keeps the 15 s pace with an unknown phase while the server answers for real (CL-08)', async () => {
    const clock = new FakeClock(0)
    const { fetch } = scriptedFetch(clock, [...firstLoad(), json(503, JSON.parse(FRAME_A))])
    const api = new ApiClient(BASE, { clock, fetch, random: () => 0 })
    api.limiter.setPhase('after')
    const store = new CabinetStore({
      call: (options) => api.call({ ...options, token: 'T' }),
      hear: () => Promise.resolve(false),
      clock,
      random: () => 0,
    })
    expect(await store.tick()).toBe(SUMMARY_INTERVAL_MS)
    // An envelope nobody could verify may be the static's noise: then once a minute.
    expect(await store.tick()).toBe(UNKNOWN_PHASE_INTERVAL_MS)
  })

  it('treats a sealed envelope instead of the summary as noise', async () => {
    const { store, paths } = setup([json(503, JSON.parse(FRAME_A))])
    await store.tick()
    expect(paths()).toEqual(['GET /me/summary'])
    expect(store.getSnapshot()).toMatchObject({ noise: true, problem: null })
  })

  it('marks a letter read only on request (CL-29)', async () => {
    const { store, paths } = setup([...firstLoad(), json(200, { message: message('m1', T) })])
    await store.tick()
    expect(store.getSnapshot().summary?.unread).toBe(1)
    await store.markRead('m1')
    expect(paths().at(-1)).toBe('POST /inbox/m1/read')
    expect(store.getSnapshot().inbox?.[0]?.readAt).toBe(T)
    expect(store.getSnapshot().summary?.unread).toBe(0)
  })

  it('acknowledges a part by an explicit call (CL-33)', async () => {
    const { store } = setup([...firstLoad(), json(200, { stage: { ...stage('s2'), acknowledgedAt: T } })])
    await store.tick()
    expect(await store.acknowledge('s2')).toBe(true)
    expect(store.getSnapshot().stages?.[0]?.acknowledgedAt).toBe(T)
  })

  it('does not guess parts: 404 is missing (CL-32)', async () => {
    const { store } = setup([json(404, { error: { code: 'not-found' } })])
    expect(await store.openStage('s3')).toBe('missing')
  })

  it('rereads an opened part when its errataAt moves (CL-31)', async () => {
    const errataAt = '2026-09-25T08:00:00.000Z'
    const { store, paths } = setup([
      ...firstLoad(),
      json(200, { stage: stage('s2') }),
      json(200, summary({ unread: 2 })),
      json(200, { items: [message('m2'), message('m1')], nextOffset: null }),
      json(200, { items: [stageSummary('s2', errataAt)] }),
      json(200, { stage: stage('s2', 'Уточнення: такт 500 мс', errataAt) }),
    ])
    await store.tick()
    await store.openStage('s2')
    await store.tick()
    expect(paths().slice(-2)).toEqual(['GET /stages', 'GET /stages/s2'])
    expect(store.getSnapshot().stageBodies.s2?.errata).toBe('Уточнення: такт 500 мс')
  })
})

describe('lists that hold an odd record', () => {
  it('shows a news item without publishedAt and skips only a broken one', async () => {
    const { store } = setup([
      json(200, summary()),
      json(200, { items: [message('m1')], nextOffset: null }),
      json(200, { items: [stageSummary('s2'), { id: 's3', position: 'third' }] }),
      json(200, { items: [{ ...news('n1'), publishedAt: null }, { id: 'n2' }], nextOffset: null }),
      json(200, { repository }),
    ])
    await store.tick()
    const s = store.getSnapshot()
    expect(s.news?.map((n) => [n.id, n.publishedAt])).toEqual([['n1', null]])
    expect(s.stages?.map((x) => x.id)).toEqual(['s2'])
    expect(s.problem).toMatch(/оголошень \(1\)/)
  })

  it('names a part it could not read and reads the list again on the next poll', async () => {
    const { store, paths } = setup([
      ...firstLoad().slice(0, 2),
      json(200, { items: [stageSummary('s2'), { id: 's3', position: 'third' }] }),
      ...firstLoad().slice(3),
      json(200, summary()),
      json(200, { items: [stageSummary('s2')] }),
    ])
    await store.tick()
    expect(store.getSnapshot().problem).toMatch(/частин завдання \(1\)/)
    await store.tick()
    expect(paths().filter((p) => p === 'GET /stages')).toHaveLength(2)
  })
})
