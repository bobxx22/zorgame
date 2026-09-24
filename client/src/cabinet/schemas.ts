import { isRecord } from '../lib/guards'
/**
 * Shape guards for the cabinet: summary, news, letters, task parts. Optional
 * fields of the contract (notice, archivedAt, errataAt) default to null;
 * unknown fields are ignored.
 */

export interface Summary {
  unread: number
  releasedStages: number
  acknowledgedStages: number
  latestNews: string | null
  repositoryAt: string | null
  serverTime: string
}

export interface News {
  id: string
  title: string
  body: string
  createdAt: string
  updatedAt: string
  /** Nullable in the contract: such an item is dated by createdAt. */
  publishedAt: string | null
  archivedAt: string | null
}

export interface Notice {
  type: string
  /** Present on type "repository". */
  url?: string
  accessStatus?: string
  reason?: string | null
  reasonCode?: string | null
}

export interface Message {
  id: string
  messageId: string | null
  stageId: string | null
  kind: string
  title: string
  body: string
  createdAt: string
  readAt: string | null
  notice: Notice | null
}

export interface StageSummary {
  id: string
  position: number
  title: string
  excerpt: string
  publishedAt: string
  releasedAt: string
  acknowledgedAt: string | null
  errataAt: string | null
}

export interface Stage extends Omit<StageSummary, 'excerpt'> {
  body: string
  errata: string | null
}

export interface Page<T> {
  items: T[]
  nextOffset: number | null
  /** Items that did not pass the guard and were left out. */
  skipped?: number
}

export interface DeveloperCheck {
  echo: string
  serverTime: string
  checks: Record<string, boolean>
}


const str = (v: unknown): v is string => typeof v === 'string'
const time = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v))
const timeOrNull = (v: unknown): v is string | null => v === null || time(v)
const count = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0
const optionalTime = (v: unknown): string | null | undefined => (v === undefined || v === null ? null : time(v) ? v : undefined)

export function parseSummary(v: unknown): Summary | null {
  if (!isRecord(v)) return null
  const { unread, releasedStages, acknowledgedStages, latestNews, repositoryAt, serverTime } = v
  if (!count(unread) || !count(releasedStages) || !count(acknowledgedStages)) return null
  if (!timeOrNull(latestNews) || !timeOrNull(repositoryAt) || !time(serverTime)) return null
  return { unread, releasedStages, acknowledgedStages, latestNews, repositoryAt, serverTime }
}

export function parseNews(v: unknown): News | null {
  if (!isRecord(v)) return null
  const { id, title, body, createdAt, updatedAt, publishedAt } = v
  const archivedAt = optionalTime(v.archivedAt)
  if (!str(id) || !str(title) || !str(body) || archivedAt === undefined) return null
  if (!time(createdAt) || !time(updatedAt) || !timeOrNull(publishedAt)) return null
  return { id, title, body, createdAt, updatedAt, publishedAt, archivedAt }
}

function parseNotice(v: unknown): Notice | null | undefined {
  if (v === undefined || v === null) return null
  if (!isRecord(v) || !str(v.type)) return undefined
  const notice: Notice = { type: v.type }
  if (str(v.url)) notice.url = v.url
  if (str(v.accessStatus)) notice.accessStatus = v.accessStatus
  if (v.reason === null || str(v.reason)) notice.reason = v.reason
  if (v.reasonCode === null || str(v.reasonCode)) notice.reasonCode = v.reasonCode
  return notice
}

export function parseMessage(v: unknown): Message | null {
  if (!isRecord(v)) return null
  const { id, messageId, stageId, kind, title, body, createdAt, readAt } = v
  const notice = parseNotice(v.notice)
  if (!str(id) || !(messageId === null || str(messageId)) || !(stageId === null || str(stageId))) return null
  if (!str(kind) || !str(title) || !str(body) || !time(createdAt) || !timeOrNull(readAt) || notice === undefined) {
    return null
  }
  return { id, messageId, stageId, kind, title, body, createdAt, readAt, notice }
}

export function parseStageSummary(v: unknown): StageSummary | null {
  if (!isRecord(v)) return null
  const { id, position, title, excerpt, publishedAt, releasedAt, acknowledgedAt } = v
  const errataAt = optionalTime(v.errataAt)
  if (!str(id) || !count(position) || !str(title) || !str(excerpt) || errataAt === undefined) return null
  if (!time(publishedAt) || !time(releasedAt) || !timeOrNull(acknowledgedAt)) return null
  return { id, position, title, excerpt, publishedAt, releasedAt, acknowledgedAt, errataAt }
}

export function parseStage(v: unknown): Stage | null {
  if (!isRecord(v)) return null
  const { id, position, title, body, publishedAt, releasedAt, acknowledgedAt, errata } = v
  const errataAt = optionalTime(v.errataAt)
  if (!str(id) || !count(position) || !str(title) || !str(body) || errataAt === undefined) return null
  if (!time(publishedAt) || !time(releasedAt) || !timeOrNull(acknowledgedAt) || !(errata === null || str(errata))) {
    return null
  }
  return { id, position, title, body, publishedAt, releasedAt, acknowledgedAt, errata, errataAt }
}

/**
 * `{items, nextOffset}`. An item that does not pass the guard is left out and
 * counted: one odd record must not hide the whole list.
 */
export function parsePage<T>(item: (v: unknown) => T | null) {
  return (v: unknown): Page<T> | null => {
    if (!isRecord(v) || !Array.isArray(v.items)) return null
    const { nextOffset } = v
    if (!(nextOffset === null || count(nextOffset))) return null
    const items: T[] = []
    let skipped = 0
    for (const raw of v.items) {
      const parsed = item(raw)
      if (parsed) items.push(parsed)
      else skipped += 1
    }
    return { items, nextOffset, skipped }
  }
}

export function wrapped<T>(key: string, item: (v: unknown) => T | null) {
  return (v: unknown): T | null => (isRecord(v) ? item(v[key]) : null)
}

/** The released parts; a part that does not parse is left out rather than hiding the others. */
export function parseStageList(v: unknown): StageSummary[] | null {
  if (!isRecord(v) || !Array.isArray(v.items)) return null
  const items: StageSummary[] = []
  for (const raw of v.items) {
    const parsed = parseStageSummary(raw)
    if (parsed) items.push(parsed)
  }
  return items
}

export function parseDeveloperCheck(v: unknown): DeveloperCheck | null {
  if (!isRecord(v) || !str(v.echo) || !time(v.serverTime) || !isRecord(v.checks)) return null
  const checks: Record<string, boolean> = {}
  for (const [name, value] of Object.entries(v.checks)) {
    if (typeof value === 'boolean') checks[name] = value
  }
  return { echo: v.echo, serverTime: v.serverTime, checks }
}
