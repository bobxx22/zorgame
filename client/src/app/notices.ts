import { accessStatusOf } from '../pages/auth-labels'

/**
 * Which cabinet event deserves a system notification. A participant whose
 * tab sits in the background hears the sound at best; a letter with a
 * deadline, a new part, a changed access status and an ended session must
 * reach them anyway. Only changes seen while the page is open count.
 */

export interface NoticeWatch {
  /** The session ended while in use (401 or expiry). */
  lost: boolean
  /** The session ends within the warning time. */
  expiring: boolean
  /** accessStatus of the application; null until read. */
  access: string | null
  /** Summary counters; null until the summary is read. */
  released: number | null
  unread: number | null
}

export interface Notice {
  /** One per kind: a newer notice of the same kind replaces the older one. */
  tag: string
  title: string
  body: string
}

export function detectNotices(prev: NoticeWatch | null, next: NoticeWatch): Notice[] {
  if (!prev) return []
  const notices: Notice[] = []

  if (next.lost && !prev.lost) {
    notices.push({
      tag: 'zoria-session',
      title: 'Сесію завершено',
      body: 'Кабінет більше не отримує листів і частин. Відкрийте клієнт і увійдіть знову.',
    })
  } else if (next.expiring && !prev.expiring) {
    notices.push({
      tag: 'zoria-session',
      title: 'Сесія скоро закінчиться',
      body: 'Увійдіть знову, щоб кабінет і далі отримував листи й частини.',
    })
  }

  if (next.access !== null && prev.access !== null && next.access !== prev.access) {
    const label = accessStatusOf(next.access)?.label ?? next.access
    notices.push({
      tag: 'zoria-access',
      title: `Доступ до репозиторію: ${label}`,
      body:
        next.access === 'verified'
          ? 'Організатори підтвердили доступ.'
          : 'Відкрийте «Заявка і доступ»: там причина і що зробити.',
    })
  }

  // A new part comes with its own letter: one notice is enough.
  if (next.released !== null && prev.released !== null && next.released > prev.released) {
    notices.push({ tag: 'zoria-stage', title: 'Нова частина завдання', body: 'Частина вже в кабінеті, розділ «Завдання».' })
  } else if (next.unread !== null && prev.unread !== null && next.unread > prev.unread) {
    notices.push({
      tag: 'zoria-letter',
      title: 'Новий лист',
      body: `Непрочитаних листів: ${String(next.unread)}. Прочитайте й позначте прочитаним у розділі «Листи».`,
    })
  }

  return notices
}

/** The tab title with the unread letters in front, as mail clients do. */
export function titleWithUnread(base: string, unread: number | null): string {
  return unread !== null && unread > 0 ? `(${String(unread)}) ${base}` : base
}
