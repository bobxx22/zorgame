import { describe, expect, it } from 'vitest'
import type { ApiResult } from '../api/client'
import { readAllPages } from './paging'
import type { Page } from './schemas'

interface Item {
  id: string
}

const ok = (items: string[], nextOffset: number | null): ApiResult<Page<Item>> => ({
  ok: true,
  status: 200,
  requestId: null,
  data: { items: items.map((id) => ({ id })), nextOffset },
})

describe('readAllPages (CL-28)', () => {
  it('reads until nextOffset is null', async () => {
    const pages: Record<number, ApiResult<Page<Item>>> = { 0: ok(['c', 'b'], 2), 2: ok(['a'], null) }
    const offsets: number[] = []
    const result = await readAllPages<Item>((offset) => {
      offsets.push(offset)
      return Promise.resolve(pages[offset] ?? ok([], null))
    })
    expect(result).toEqual({ ok: true, items: [{ id: 'c' }, { id: 'b' }, { id: 'a' }] })
    expect(offsets).toEqual([0, 2])
  })

  it('starts over when a new item shifted the pages', async () => {
    // Pass 1: page 0 = [c, b]; then "d" is published, so page 2 = [b, a] repeats b.
    const replies = [ok(['c', 'b'], 2), ok(['b', 'a'], null), ok(['d', 'c'], 2), ok(['b', 'a'], null)]
    const offsets: number[] = []
    const result = await readAllPages<Item>((offset) => {
      offsets.push(offset)
      return Promise.resolve(replies.shift() ?? ok([], null))
    })
    expect(offsets).toEqual([0, 2, 0, 2])
    expect(result).toEqual({ ok: true, items: ['d', 'c', 'b', 'a'].map((id) => ({ id })) })
  })

  it('passes a failure through', async () => {
    const failure: ApiResult<Page<Item>> = { ok: false, error: { kind: 'network', reason: 'timeout' } }
    expect(await readAllPages<Item>(() => Promise.resolve(failure))).toEqual({ ok: false, result: failure })
  })

  it('never returns duplicates, even when the list keeps moving', async () => {
    let n = 0
    const result = await readAllPages<Item>((offset) => {
      n += 1
      return Promise.resolve(offset === 0 ? ok([`new${String(n)}`, 'x'], 2) : ok(['x', 'y'], null))
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(new Set(result.items.map((i) => i.id)).size).toBe(result.items.length)
  })
})
