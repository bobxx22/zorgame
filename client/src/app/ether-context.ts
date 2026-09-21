import { createContext, useContext, useSyncExternalStore } from 'react'
import type { EtherListener, EtherSnapshot } from '../ether/listener'

export const EtherContext = createContext<EtherListener | null>(null)

export function useEtherListener(): EtherListener {
  const listener = useContext(EtherContext)
  if (!listener) throw new Error('useEther must be used inside <EtherProvider>')
  return listener
}

export function useEther(): EtherSnapshot {
  const listener = useEtherListener()
  return useSyncExternalStore(listener.subscribe, listener.getSnapshot)
}
