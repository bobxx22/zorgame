import { useEffect, useMemo, type ReactNode } from 'react'
import { CabinetStore } from '../cabinet/store'
import { useAuth } from './auth-context'
import { CabinetContext } from './cabinet-context'
import { useEther } from './ether-context'

/** One cabinet per login session; it polls while the session is alive. */
export function CabinetProvider({ children }: { children: ReactNode }) {
  const { session, lost, call } = useAuth()
  const { station } = useEther()
  const token = session?.token ?? null

  const store = useMemo(() => (token ? new CabinetStore({ call }) : null), [token, call])

  useEffect(() => {
    store?.setPhase(station.phase)
  }, [store, station.phase])

  useEffect(() => {
    if (!store || lost) return
    store.start()
    return () => {
      store.stop()
    }
  }, [store, lost])

  return <CabinetContext.Provider value={store}>{children}</CabinetContext.Provider>
}
