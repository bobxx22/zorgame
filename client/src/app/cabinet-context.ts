import { createContext, useContext, useSyncExternalStore } from 'react'
import type { CabinetSnapshot, CabinetStore } from '../cabinet/store'

export const CabinetContext = createContext<CabinetStore | null>(null)

const noSubscribe = () => () => undefined
const noSnapshot = () => null

/** The store of the current session, or null when nobody is logged in. */
export function useCabinetStore(): CabinetStore | null {
  return useContext(CabinetContext)
}

export function useCabinet(): CabinetSnapshot | null {
  const store = useContext(CabinetContext)
  return useSyncExternalStore(store ? store.subscribe : noSubscribe, store ? store.getSnapshot : noSnapshot)
}
