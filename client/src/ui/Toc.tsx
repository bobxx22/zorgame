import { useEffect, useState, type ReactNode } from 'react'
import { cls } from '../lib/cls'
import { scrollToId } from './scroll'

export interface TocItem {
  id: string
  /** Section number, or a date printed above the label (`stacked`). */
  n?: string
  label: ReactNode
  stacked?: boolean
  dim?: boolean
  chips?: ReactNode
}

/** The heading nearest to the top of the screen, as the site's contents rail marks it. */
function useActiveSection(ids: readonly string[]): string | null {
  const [active, setActive] = useState<string | null>(null)
  const key = ids.join('\n')

  useEffect(() => {
    const elements = key
      .split('\n')
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null)
    if (elements.length === 0 || typeof IntersectionObserver === 'undefined') return
    const visible = new Map<string, boolean>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) visible.set(entry.target.id, entry.isIntersecting)
        const first = elements.find((el) => visible.get(el.id))
        if (first) setActive(first.id)
      },
      { rootMargin: '-64px 0px -55% 0px' },
    )
    for (const el of elements) observer.observe(el)
    return () => {
      observer.disconnect()
    }
  }, [key])

  return active
}

export function Toc({ items, title = 'На цій сторінці' }: { items: readonly TocItem[]; title?: string }) {
  const active = useActiveSection(items.map((item) => item.id))
  return (
    <>
      <p className="rh onpage">{title}</p>
      <nav className="toc">
        <ol>
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={cls(item.stacked && 'wn', active === item.id && 'on', item.dim && 'dim')}
                onClick={() => {
                  scrollToId(item.id)
                }}
              >
                {item.n && <span className="n">{item.n}</span>}
                <span>{item.label}</span>
              </button>
              {item.chips && <div className="chips">{item.chips}</div>}
            </li>
          ))}
        </ol>
      </nav>
    </>
  )
}
