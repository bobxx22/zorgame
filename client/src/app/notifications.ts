/** System notifications: a way to reach a participant whose tab is in the background. */

export type NoticePermission = NotificationPermission | 'unsupported'

export function noticePermission(): NoticePermission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
}

/** Shows a notification while the tab is hidden; `tag` lets a newer one of the same kind replace the older. */
export function notify(title: string, body: string, tag = 'zoria-registration') {
  if (noticePermission() !== 'granted') return
  // A visible tab shows it and sounds it already.
  if (document.visibilityState === 'visible') return
  try {
    new Notification(title, { body, tag })
  } catch {
    // Some browsers allow notifications only from a service worker: the page and the sound still tell.
  }
}

/**
 * Asks for the permission; called from a click (arming the application,
 * logging in, the settings), the gesture browsers require. Resolves with the
 * permission as it stands afterwards.
 */
export async function askNotifications(): Promise<NoticePermission> {
  if (noticePermission() !== 'default') return noticePermission()
  try {
    return await Notification.requestPermission()
  } catch {
    return noticePermission()
  }
}
