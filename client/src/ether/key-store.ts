import type { KeyStore } from './listener'

/** Station key cached in the browser per server; a broken storage just means re-reading it. */
export function browserKeyStore(serverId: string): KeyStore {
  const name = `zoria.stationKey.${serverId}`
  return {
    load() {
      try {
        const raw = window.localStorage.getItem(name)
        return raw === null ? null : (JSON.parse(raw) as unknown)
      } catch {
        return null
      }
    },
    save(body) {
      try {
        window.localStorage.setItem(name, JSON.stringify(body))
      } catch {
        // Private mode or full storage: the key stays in memory for this session.
      }
    },
  }
}
