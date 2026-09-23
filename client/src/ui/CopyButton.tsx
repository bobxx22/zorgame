import { useEffect, useState } from 'react'
import { cls } from '../lib/cls'
import { Icon } from './Icon'

/** Copies a value; `label` makes it a text button, otherwise an icon button like the site's code blocks. */
export function CopyButton({ text, label }: { text: string; label?: string }) {
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
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true)
      },
      () => {
        setCopied(false)
      },
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
      title={copied ? 'Скопійовано' : 'Копіювати'}
      aria-label={copied ? 'Скопійовано' : 'Копіювати'}
      onClick={copy}
    >
      <Icon name={copied ? 'check' : 'copy'} />
    </button>
  )
}
