import { useEffect, useMemo, type ReactNode } from 'react'
import { browserKeyStore, browserPollMarks } from '../ether/key-store'
import { EtherListener } from '../ether/listener'
import { EtherContext } from './ether-context'
import { useServer } from './server-context'

/** One ether listener per server; it runs while the app is open. */
export function EtherProvider({ children }: { children: ReactNode }) {
  const { server, api } = useServer()

  const listener = useMemo(
    () =>
      new EtherListener({
        api,
        keyStore: browserKeyStore(server.id),
        letterStore: browserKeyStore(server.id, 'letter'),
        marks: browserPollMarks(server.id),
        pinnedFingerprint: server.keyFingerprint,
      }),
    [api, server.id, server.keyFingerprint],
  )

  useEffect(() => {
    listener.start()
    return () => {
      listener.stop()
    }
  }, [listener])

  return <EtherContext.Provider value={listener}>{children}</EtherContext.Provider>
}
