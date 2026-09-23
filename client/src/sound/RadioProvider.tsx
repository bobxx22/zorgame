import { useEffect, useState, type ReactNode } from 'react'
import { Radio } from './radio'
import { RadioContext } from './radio-context'

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
}

/** One radio for the page; any click or key unlocks audio, M toggles it (as in the intro). */
export function RadioProvider({ children }: { children: ReactNode }) {
  const [radio] = useState(() => new Radio())

  useEffect(() => {
    const onPointer = () => {
      radio.unlock()
    }
    const onKey = (event: KeyboardEvent) => {
      radio.unlock()
      if (event.code !== 'KeyM' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
      if (typing(event.target)) return
      radio.toggleAll()
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [radio])

  return <RadioContext.Provider value={radio}>{children}</RadioContext.Provider>
}
