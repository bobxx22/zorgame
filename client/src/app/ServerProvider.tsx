import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { ApiClient } from '../api/client'
import { systemClock } from '../api/clock'
import { DEFAULT_BUCKET, EtherLimiter } from '../api/rate-limit'
import { browserGate } from '../api/shared-gate'
import {
  availableServers,
  readStoredServer,
  resolveServer,
  storeServer,
  type ServerEnv,
  type ServerId,
} from '../config/servers'
import { ServerContext, type ServerState } from './server-context'

/**
 * Only the keys the server list needs: the whole import.meta.env would carry
 * every VITE_ variable into the bundle, the application code included.
 */
const env: ServerEnv = {
  VITE_ZORIA_SERVER: import.meta.env.VITE_ZORIA_SERVER,
  VITE_ZORIA_API_URL: import.meta.env.VITE_ZORIA_API_URL,
  VITE_ZORIA_PROD_KEY_FINGERPRINT: import.meta.env.VITE_ZORIA_PROD_KEY_FINGERPRINT,
  VITE_ZORIA_STAND_KEY_FINGERPRINT: import.meta.env.VITE_ZORIA_STAND_KEY_FINGERPRINT,
  VITE_ZORIA_CUSTOM_KEY_FINGERPRINT: import.meta.env.VITE_ZORIA_CUSTOM_KEY_FINGERPRINT,
}

/**
 * One client per server for the life of the page: switching to the stand and
 * back keeps the bucket and the jam gate; the gate is also kept in storage, so
 * a reload or a second tab does not knock on a jammed station (CL-07).
 */
const clients = new Map<string, ApiClient>()

function clientFor(apiBase: string): ApiClient {
  let client = clients.get(apiBase)
  if (!client) {
    client = new ApiClient(apiBase, { limiter: new EtherLimiter(systemClock, DEFAULT_BUCKET, browserGate(apiBase)) })
    clients.set(apiBase, client)
  }
  return client
}

export function ServerProvider({ children }: { children: ReactNode }) {
  const [server, setServer] = useState(() => resolveServer(env, readStoredServer()))
  const servers = useMemo(() => availableServers(env), [])
  const api = useMemo(() => clientFor(server.apiBase), [server.apiBase])

  const selectServer = useCallback((id: ServerId) => {
    storeServer(id)
    setServer(resolveServer(env, id))
  }, [])

  const value = useMemo<ServerState>(
    () => ({ server, servers, api, selectServer }),
    [server, servers, api, selectServer],
  )
  return <ServerContext.Provider value={value}>{children}</ServerContext.Provider>
}
