import { createContext, useContext } from 'react'
import type { ServerConfig, ServerId } from '../config/servers'

export interface ServerState {
  server: ServerConfig
  servers: ServerConfig[]
  selectServer: (id: ServerId) => void
}

export const ServerContext = createContext<ServerState | null>(null)

export function useServer(): ServerState {
  const state = useContext(ServerContext)
  if (!state) throw new Error('useServer must be used inside <ServerProvider>')
  return state
}
