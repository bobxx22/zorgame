import { useEffect, useRef, useState } from 'react'
import { cls } from '../lib/cls'
import { Icon } from './Icon'

/**
 * Copies a value; `label` makes it a text button, otherwise an icon button like
 * the site's code blocks. When the clipboard refuses (a page over plain http,
 * a window without focus) the value is shown selected next to the button to
 * copy by hand - never in a prompt, which would freeze the page and its ether.
 */
export function CopyButton({ text, label, title }: { text: string; label?: string; title?: string }) {
  const [copied, setCopied] = useState(false)
  const [manual, setManual] = useState(false)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!manual) return
    field.current?.focus()
    field.current?.select()
  }, [manual])

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
      setManual(true)
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

  const byHand = manual && (
    <input
      ref={field}
      className="copy-manual"
      readOnly
      value={text}
      aria-label="Виділено: скопіюйте Ctrl+C"
      title="Виділено: скопіюйте Ctrl+C"
      onBlur={() => {
        setManual(false)
      }}
    />
  )

  if (label) {
    return (
      <>
        <button type="button" className={cls('btn sm', copied && 'done')} onClick={copy}>
          <Icon name={copied ? 'check' : 'copy'} />
          {copied ? 'Скопійовано' : label}
        </button>
        {byHand}
      </>
    )
  }
  return (
    <>
      <button
        type="button"
        className={cls('ib', copied && 'done')}
        title={copied ? 'Скопійовано' : (title ?? 'Копіювати')}
        aria-label={copied ? 'Скопійовано' : (title ?? 'Копіювати')}
        onClick={copy}
      >
        <Icon name={copied ? 'check' : 'copy'} />
      </button>
      {byHand}
    </>
  )
}
