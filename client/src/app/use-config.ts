import { useEffect, useState } from 'react'
import type { ApiClient } from '../api/client'
import { parseConfig, type Config } from '../auth/schemas'
import { useServer } from './server-context'

/**
 * GET /public/config once per server. It counts in the ether limit, so it is
 * read sparingly: cached for the session, two attempts at most.
 */
const cache = new WeakMap<ApiClient, Promise<Config | null>>()

function loadConfig(api: ApiClient): Promise<Config | null> {
  let pending = cache.get(api)
  if (!pending) {
    pending = api
      .call({ path: '/public/config', parse: parseConfig, retry: { transient: true, busy: true, maxAttempts: 2 } })
      .then((result) => {
        if (!result.ok) cache.delete(api)
        return result.ok ? result.data : null
      })
    cache.set(api, pending)
  }
  return pending
}

export type ConfigState = { status: 'loading' } | { status: 'ready'; config: Config } | { status: 'unavailable' }

export function useConfig(): ConfigState {
  const { api } = useServer()
  const [state, setState] = useState<{ api: ApiClient; value: ConfigState }>({ api, value: { status: 'loading' } })

  useEffect(() => {
    let active = true
    void loadConfig(api).then((config) => {
      if (active) setState({ api, value: config ? { status: 'ready', config } : { status: 'unavailable' } })
    })
    return () => {
      active = false
    }
  }, [api])

  return state.api === api ? state.value : { status: 'loading' }
}
