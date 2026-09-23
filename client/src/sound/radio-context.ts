import { createContext, useContext, useSyncExternalStore } from 'react'
import type { Radio, RadioSnapshot } from './radio'

export const RadioContext = createContext<Radio | null>(null)

export function useRadio(): Radio {
  const radio = useContext(RadioContext)
  if (!radio) throw new Error('useRadio must be used inside <RadioProvider>')
  return radio
}

export function useRadioState(): RadioSnapshot {
  const radio = useRadio()
  return useSyncExternalStore(radio.subscribe, radio.getSnapshot)
}
