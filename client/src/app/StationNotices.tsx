import { useEffect, useRef } from 'react'
import { EXPIRY_WARNING_MS } from '../auth/session-store'
import { useNow } from '../lib/use-now'
import { useAuth } from './auth-context'
import { useCabinet } from './cabinet-context'
import { detectNotices, titleWithUnread, type NoticeWatch } from './notices'
import { notify } from './notifications'

/**
 * Cabinet events as system notifications (they show only while the tab is
 * hidden) and the unread count in the tab title. Renders nothing.
 */
export function StationNotices() {
  const { session, lost } = useAuth()
  const cabinet = useCabinet()
  const now = useNow(60_000)

  const expiring = session !== null && !lost && Date.parse(session.expiresAt) - now < EXPIRY_WARNING_MS
  const access = cabinet?.repository ? cabinet.repository.accessStatus : null
  const released = cabinet?.summary?.releasedStages ?? null
  const unread = cabinet?.summary?.unread ?? null

  const previous = useRef<NoticeWatch | null>(null)
  useEffect(() => {
    const next: NoticeWatch = { lost, expiring, access, released, unread }
    for (const notice of detectNotices(previous.current, next)) notify(notice.title, notice.body, notice.tag)
    previous.current = next
  }, [lost, expiring, access, released, unread])

  const baseTitle = useRef(document.title)
  useEffect(() => {
    document.title = titleWithUnread(baseTitle.current, session && !lost ? unread : null)
  }, [session, lost, unread])

  return null
}
