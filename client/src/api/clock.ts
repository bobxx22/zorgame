/** Time source and cancellable sleep; injected so tests run without real waiting. */
export interface Clock {
  now(): number
  sleep(ms: number, signal?: AbortSignal): Promise<void>
}

export function abortReason(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError')
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortReason(signal))
        return
      }
      const onAbort = () => {
        globalThis.clearTimeout(timer)
        reject(abortReason(signal))
      }
      const timer = globalThis.setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, Math.max(0, ms))
      signal?.addEventListener('abort', onAbort, { once: true })
    }),
}
