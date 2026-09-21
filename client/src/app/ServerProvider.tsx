import { useCallback, useMemo, useState, type ReactNode } from 'react'
import {
  availableServers,
  readStoredServer,
  resolveServer,
  storeServer,
  type ServerId,
} from '../config/servers'
import { ServerContext, type ServerState } from './server-context'

const env = import.meta.env

export function ServerProvider({ children }: { children: ReactNode }) {
  const [server, setServer] = useState(() => resolveServer(env, readStoredServer()))
  const servers = useMemo(() => availableServers(env), [])

  const selectServer = useCallback((id: ServerId) => {
    storeServer(id)
    setServer(resolveServer(env, id))
  }, [])

  const value = useMemo<ServerState>(() => ({ server, servers, selectServer }), [server, servers, selectServer])
  return <ServerContext.Provider value={value}>{children}</ServerContext.Provider>
}
