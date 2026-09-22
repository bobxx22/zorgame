import type { ApiResult } from '../api/client'
import type { Page } from './schemas'

/**
 * Reads a paged list to nextOffset: null (CL-28). Items are matched by id and
 * never duplicated. The list is newest first, so an item published while
 * paging shifts the offsets: an id seen twice in one pass means exactly that,
 * and paging starts over from zero.
 */

export const PAGE_LIMIT = 100
export const MAX_RESTARTS = 3
/** Hard stop against a server that never ends the list. */
export const MAX_PAGES = 200

export type PagedResult<T> = { ok: true; items: T[] } | { ok: false; result: ApiResult<Page<T>> }

export async function readAllPages<T extends { id: string }>(
  fetchPage: (offset: number, limit: number) => Promise<ApiResult<Page<T>>>,
): Promise<PagedResult<T>> {
  for (let pass = 0; pass <= MAX_RESTARTS; pass += 1) {
    const seen = new Set<string>()
    const items: T[] = []
    let offset: number | null = 0
    let shifted = false

    for (let page = 0; offset !== null && page < MAX_PAGES; page += 1) {
      const result = await fetchPage(offset, PAGE_LIMIT)
      if (!result.ok) return { ok: false, result }
      for (const item of result.data.items) {
        if (seen.has(item.id)) {
          shifted = true
          continue
        }
        seen.add(item.id)
        items.push(item)
      }
      if (shifted) break
      offset = result.data.nextOffset
    }

    if (!shifted) return { ok: true, items }
  }
  // Still moving after several passes: keep what the last pass read, without duplicates.
  return readOnce(fetchPage)
}

async function readOnce<T extends { id: string }>(
  fetchPage: (offset: number, limit: number) => Promise<ApiResult<Page<T>>>,
): Promise<PagedResult<T>> {
  const byId = new Map<string, T>()
  let offset: number | null = 0
  for (let page = 0; offset !== null && page < MAX_PAGES; page += 1) {
    const result = await fetchPage(offset, PAGE_LIMIT)
    if (!result.ok) return { ok: false, result }
    for (const item of result.data.items) if (!byId.has(item.id)) byId.set(item.id, item)
    offset = result.data.nextOffset
  }
  return { ok: true, items: [...byId.values()] }
}
