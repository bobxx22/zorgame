import { useCallback, useEffect, useRef } from 'react'

/**
 * A signal that aborts when the component goes away, so a request started from
 * it does not outlive it and never sets state on an unmounted screen.
 */
export function useUnmountSignal(): () => AbortSignal {
  const controller = useRef<AbortController | null>(null)
  useEffect(() => {
    const own = new AbortController()
    controller.current = own
    return () => {
      own.abort()
    }
  }, [])
  return useCallback(() => controller.current?.signal ?? AbortSignal.abort(), [])
}
