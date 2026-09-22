import { useEffect, useState } from 'react'

export function CopyButton({ text, label = 'Копіювати' }: { text: string; label?: string }) {
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

  return (
    <button
      type="button"
      className="link-button small"
      onClick={() => {
        navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true)
          },
          () => {
            setCopied(false)
          },
        )
      }}
    >
      {copied ? 'скопійовано' : label}
    </button>
  )
}
