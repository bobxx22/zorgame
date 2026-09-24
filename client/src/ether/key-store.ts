import { isRecord } from '../lib/guards'
import { readJson, writeJson } from '../lib/storage'
import type { KeyStore, PollMarks, Route } from './listener'

/** Station key (or the Keeper's letter) kept in the browser per server; broken storage just means reading again. */
export function browserKeyStore(serverId: string, kind: 'stationKey' | 'letter' = 'stationKey'): KeyStore {
  const name = `zoria.${kind}.${serverId}`
  return {
    load: () => readJson(name),
    save: (body) => {
      writeJson(name, body)
    },
  }
}

/** Times of the last ether requests of a server, shared by all tabs and reloads (CL-08). */
export function browserPollMarks(serverId: string): PollMarks {
  const name = `zoria.poll.${serverId}`
  const read = (): Record<string, unknown> => {
    const stored = readJson(name)
    return isRecord(stored) ? stored : {}
  }
  return {
    last(route: Route) {
      const value = read()[route]
      return typeof value === 'number' && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY
    },
    mark(route: Route, atMs: number) {
      writeJson(name, { ...read(), [route]: atMs })
    },
  }
}
