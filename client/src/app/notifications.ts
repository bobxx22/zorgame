/** System notifications: a way to reach a participant whose tab is in the background. */

export function notify(title: string, body: string) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  // A visible tab shows it and sounds it already.
  if (document.visibilityState === 'visible') return
  try {
    new Notification(title, { body, tag: 'zoria-registration' })
  } catch {
    // Some browsers allow notifications only from a service worker: the page and the sound still tell.
  }
}

/** Asked when the participant arms the application: that click is the gesture browsers require. */
export function askNotifications(): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'default') return
  void Notification.requestPermission().catch(() => undefined)
}
