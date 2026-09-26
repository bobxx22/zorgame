import { describe, expect, it } from 'vitest'
import { PART_PLAN } from '../config/season'
import { bridgeRows } from './bridge'
import type { StageSummary } from './schemas'

const T = '2026-09-28T09:00:00.000Z'
const stage = (id: string, position: number, title: string): StageSummary => ({
  id,
  position,
  title,
  excerpt: '',
  publishedAt: T,
  releasedAt: T,
  acknowledgedAt: null,
  errataAt: null,
})
const rows = (stages: StageSummary[]) =>
  bridgeRows(stages, PART_PLAN).map((r) => (r.kind === 'stage' ? `${r.stage.id}@${String(r.position)}` : `plan${String(r.position)}`))

describe('bridgeRows', () => {
  it('shows the whole plan before anything is released', () => {
    expect(rows([])).toEqual(['plan2', 'plan3', 'plan4', 'plan5'])
  })

  it('puts a released part in place of its planned one', () => {
    expect(rows([stage('s2', 2, 'Щось інше')])).toEqual(['s2@2', 'plan3', 'plan4', 'plan5'])
  })

  it('knows a planned part by its title or "Частина N" when the organizer numbered it otherwise', () => {
    expect(rows([stage('a', 1, 'Перший локальний бій')])).toEqual(['a@1', 'plan3', 'plan4', 'plan5'])
    expect(rows([stage('b', 1, 'Частина 2. Правила гри')])).toEqual(['b@1', 'plan3', 'plan4', 'plan5'])
  })

  it('does not wait for a planned part below a released one', () => {
    expect(rows([stage('s3', 3, 'Штаб')])).toEqual(['s3@3', 'plan4', 'plan5'])
  })
})
