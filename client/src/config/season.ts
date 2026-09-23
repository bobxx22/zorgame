/** Dates of the season from the part 1 task text (UTC). */
export const SEASON = {
  /** The window starts somewhere in this range and lasts at least 10 h. */
  windowEarliest: '2026-09-24T05:00:00.000Z',
  windowLatest: '2026-09-25T09:00:00.000Z',
  /** accessStatus must be "verified" by then. */
  accessDeadline: '2026-10-05T21:00:00.000Z',
  part2: '2026-09-28',
} as const

/** GitHub account named in the task text; the server's /public/config is the authority. */
export const ORGANIZER_GITHUB = 'zoria-net-bot'

export type SeasonKind = 'part' | 'window' | 'ev' | 'play' | 'fin'

export interface SeasonEvent {
  label: string
  /** Day label as the site prints it. */
  day: string
  kind: SeasonKind
  from: string
  /** Set for spans (the window, the stages of play). */
  to?: string
}

/** The season calendar of the site (reference/calendar), 21.09 - 21.10. */
export const SEASON_START = '2026-09-21T00:00:00.000Z'
export const SEASON_END = '2026-10-22T00:00:00.000Z'

export const SEASON_EVENTS: readonly SeasonEvent[] = [
  { label: 'Частина 1 і ефір', day: '21.09', kind: 'part', from: '2026-09-21T00:00:00.000Z' },
  { label: 'Початок просвіту', day: '24-25.09', kind: 'window', from: SEASON.windowEarliest, to: SEASON.windowLatest },
  { label: 'Жеребкування', day: '26.09', kind: 'ev', from: '2026-09-26T09:00:00.000Z' },
  { label: 'Частина 2', day: '28.09', kind: 'part', from: '2026-09-28T00:00:00.000Z' },
  { label: 'Частини 3 і 4, строк доступу', day: '05.10', kind: 'part', from: '2026-10-05T00:00:00.000Z' },
  { label: 'Заморожування коду', day: '09.10', kind: 'ev', from: '2026-10-09T21:00:00.000Z' },
  { label: 'Груповий етап', day: '11-14.10', kind: 'play', from: '2026-10-11T21:00:00.000Z', to: '2026-10-14T05:00:00.000Z' },
  { label: 'Три вечори', day: '15-17.10', kind: 'play', from: '2026-10-15T00:00:00.000Z', to: '2026-10-18T00:00:00.000Z' },
  { label: 'Випробування', day: '18.10', kind: 'ev', from: '2026-10-18T15:00:00.000Z' },
  { label: 'Підсумок', day: '21.10', kind: 'fin', from: '2026-10-21T18:00:00.000Z' },
]

/** Place of an instant on the season track, 0..100 %; null outside the season. */
export function seasonPercent(at: string | number): number | null {
  const ms = typeof at === 'number' ? at : Date.parse(at)
  const start = Date.parse(SEASON_START)
  const end = Date.parse(SEASON_END)
  if (Number.isNaN(ms) || ms < start || ms > end) return null
  return ((ms - start) / (end - start)) * 100
}

export interface PartPlan {
  position: number
  title: string
  /** When the part is expected in the cabinet, as the site prints it. */
  day: string
}

/**
 * Parts still to come, named as the site names them (/spec/) and dated by the
 * calendar. Part 1 is the task text itself: it shows here only if the cabinet
 * releases it. The cabinet's own list wins once a part is released.
 */
export const PART_PLAN: readonly PartPlan[] = [
  { position: 2, title: 'Перший локальний бій', day: '28.09' },
  { position: 3, title: 'Ігровий штаб', day: '05.10' },
  { position: 4, title: 'Збірка і здача', day: '05.10' },
  { position: 5, title: 'Розклад', day: '11.10' },
]
