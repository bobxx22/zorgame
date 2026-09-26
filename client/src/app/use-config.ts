import { useEffect, useState } from 'react'
import type { ApiClient } from '../api/client'
import { parseConfig, type Config } from '../auth/schemas'
import { useAuth } from './auth-context'
import { useEther } from './ether-context'
import { useServer } from './server-context'

/**
 * GET /public/config per server. Before the window the station answers it
 * with noise and it costs a token of the ether limit, so it is asked only in
 * the window and after, or with a session while no frame is verified (a
 * session means the window has come); again when the phase changes or
 * someone logs in, and once a minute while it keeps failing. A good answer is
 * kept for the page.
 */
const known = new WeakMap<ApiClient, Config>()
const RETRY_MS = 60_000

export type ConfigState = { status: 'loading' } | { status: 'ready'; config: Config } | { status: 'unavailable' }

export function useConfig(): ConfigState {
  const { api } = useServer()
  const { station } = useEther()
  const { session } = useAuth()
  const loggedIn = session !== null
  const open = station.phase === 'window' || station.phase === 'after' || (station.phase === null && loggedIn)
  const [loaded, setLoaded] = useState<{ api: ApiClient; value: ConfigState } | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!open || known.has(api)) return
    const controller = new AbortController()
    let timer: number | null = null
    void api
      .call({
        path: '/public/config',
        parse: parseConfig,
        retry: { transient: true, busy: true, maxAttempts: 2 },
        signal: controller.signal,
      })
      .then((result) => {
        if (controller.signal.aborted) return
        if (result.ok) {
          known.set(api, result.data)
          setLoaded({ api, value: { status: 'ready', config: result.data } })
          return
        }
        setLoaded({ api, value: { status: 'unavailable' } })
        timer = window.setTimeout(() => {
          setAttempt((n) => n + 1)
        }, RETRY_MS)
      })
    return () => {
      controller.abort()
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [api, open, loggedIn, attempt])

  const config = known.get(api)
  if (config) return { status: 'ready', config }
  if (!open) return { status: 'unavailable' }
  return loaded?.api === api ? loaded.value : { status: 'loading' }
}
