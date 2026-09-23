import type { SharedGate } from './rate-limit'

/** The jam gate of one server in localStorage: every tab and every reload of the page sees it. */
export function browserGate(apiBase: string): SharedGate {
  const key = `zoria.gate.${apiBase}`
  return {
    load() {
      try {
        const value = Number(window.localStorage.getItem(key))
        return Number.isFinite(value) ? value : 0
      } catch {
        return 0
      }
    },
    save(until) {
      try {
        window.localStorage.setItem(key, String(until))
      } catch {
        // No storage: the gate still holds this tab.
      }
    },
  }
}
