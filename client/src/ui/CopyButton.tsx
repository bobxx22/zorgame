import { useEffect, useState } from 'react'
import { cls } from '../lib/cls'
import { Icon } from './Icon'

/**
 * Copies a value; `label` makes it a text button, otherwise an icon button like
 * the site's code blocks. Without the Clipboard API (a page over plain http)
 * the value is offered in a prompt to copy by hand.
 */
export function CopyButton({ text, label, title }: { text: string; label?: string; title?: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => {
      setCopied(false)
    }, 1500)
    return () => {
      window.clearTimeout(timer)
    }
  }, [copied])

  function copy() {
    const byHand = () => {
      window.prompt('Скопіюйте вручну:', text)
    }
    const clipboard = (navigator as Partial<Navigator>).clipboard
    if (!clipboard) {
      byHand()
      return
    }
    clipboard.writeText(text).then(
      () => {
        setCopied(true)
      },
      byHand,
    )
  }

  if (label) {
    return (
      <button type="button" className={cls('btn sm', copied && 'done')} onClick={copy}>
        <Icon name={copied ? 'check' : 'copy'} />
        {copied ? 'Скопійовано' : label}
      </button>
    )
  }
  return (
    <button
      type="button"
      className={cls('ib', copied && 'done')}
      title={copied ? 'Скопійовано' : (title ?? 'Копіювати')}
      aria-label={copied ? 'Скопійовано' : (title ?? 'Копіювати')}
      onClick={copy}
    >
      <Icon name={copied ? 'check' : 'copy'} />
    </button>
  )
}
