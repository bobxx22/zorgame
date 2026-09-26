import { describe, expect, it } from 'vitest'
import { detectNotices, titleWithUnread, type NoticeWatch } from './notices'

const calm: NoticeWatch = { lost: false, expiring: false, access: 'pending', released: 1, unread: 0 }
const tags = (prev: NoticeWatch | null, next: Partial<NoticeWatch>) =>
  detectNotices(prev, { ...calm, ...next }).map((n) => n.tag)

describe('detectNotices', () => {
  it('stays quiet about what was true when the page loaded', () => {
    expect(tags(null, { unread: 3, lost: true })).toEqual([])
    expect(tags({ ...calm, access: null, released: null, unread: null }, { access: 'verified', unread: 2 })).toEqual([])
  })

  it('tells about a new letter, a new part (once for both) and a changed access status', () => {
    expect(tags(calm, { unread: 1 })).toEqual(['zoria-letter'])
    expect(tags(calm, { unread: 1, released: 2 })).toEqual(['zoria-stage'])
    expect(tags(calm, { access: 'needs-attention' })).toEqual(['zoria-access'])
    expect(tags(calm, { unread: 0 })).toEqual([])
  })

  it('warns before the session ends and when it has ended', () => {
    expect(tags(calm, { expiring: true })).toEqual(['zoria-session'])
    expect(detectNotices({ ...calm, expiring: true }, { ...calm, expiring: true, lost: true })[0]?.title).toBe(
      'Сесію завершено',
    )
  })
})

describe('titleWithUnread', () => {
  it('puts the unread count in front', () => {
    expect(titleWithUnread('Зоря.нет · клієнт', 2)).toBe('(2) Зоря.нет · клієнт')
    expect(titleWithUnread('Зоря.нет · клієнт', 0)).toBe('Зоря.нет · клієнт')
    expect(titleWithUnread('Зоря.нет · клієнт', null)).toBe('Зоря.нет · клієнт')
  })
})
