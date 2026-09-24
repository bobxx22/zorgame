import { readText, writeText } from '../lib/storage'
import type { SharedGate } from './rate-limit'

/** The jam gate of one server in localStorage: every tab and every reload of the page sees it. */
export function browserGate(apiBase: string): SharedGate {
  const key = `zoria.gate.${apiBase}`
  return {
    load() {
      const value = Number(readText(key))
      return Number.isFinite(value) ? value : 0
    },
    save(until) {
      writeText(key, String(until))
    },
  }
}
