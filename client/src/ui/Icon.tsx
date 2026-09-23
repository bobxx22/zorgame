import type { ReactNode } from 'react'

/** 16 px line icons drawn the way the site draws its own: stroke 1.5, round joins. */
const PATHS = {
  doc: (
    <>
      <path d="M4 2.5h5.5L12 5v8.5H4z" />
      <path d="M9.5 2.5V5H12" />
      <path d="M6 8.5h4" />
      <path d="M6 11h3" />
    </>
  ),
  code: (
    <>
      <path d="M5.5 4 2 8l3.5 4" />
      <path d="M10.5 4 14 8l-3.5 4" />
      <path d="M9 3 7 13" />
    </>
  ),
  book: (
    <>
      <path d="M8 4.2C6.8 3.3 5 3 2.5 3v9.5c2.5 0 4.3.3 5.5 1.2 1.2-.9 3-1.2 5.5-1.2V3C11 3 9.2 3.3 8 4.2z" />
      <path d="M8 4.2v9.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.5h11" />
      <path d="M5.5 2v3" />
      <path d="M10.5 2v3" />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3l2 1.5" />
    </>
  ),
  go: (
    <>
      <path d="M3 8h10" />
      <path d="M9 4l4 4-4 4" />
    </>
  ),
  back: (
    <>
      <path d="M13 8H3" />
      <path d="M7 4 3 8l4 4" />
    </>
  ),
  menu: (
    <>
      <path d="M3 4.5h10" />
      <path d="M3 8h10" />
      <path d="M3 11.5h10" />
    </>
  ),
  close: (
    <>
      <path d="M4 4l8 8" />
      <path d="M12 4l-8 8" />
    </>
  ),
  sound: (
    <>
      <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" />
      <path d="M10.6 5.8a3 3 0 0 1 0 4.4" />
      <path d="M12.4 4a5.6 5.6 0 0 1 0 8" />
    </>
  ),
  mute: (
    <>
      <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" />
      <path d="M10.5 6.2l3.4 3.6" />
      <path d="M13.9 6.2l-3.4 3.6" />
    </>
  ),
  mail: (
    <>
      <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" />
      <path d="M2.8 4.5 8 8.6l5.2-4.1" />
    </>
  ),
  mast: (
    <>
      <path d="M5.6 14 8 5.5l2.4 8.5" />
      <path d="M6.5 10.8h3" />
      <circle cx="8" cy="3.6" r="1" />
      <path d="M4.6 2.2a4.6 4.6 0 0 0 0 3" />
      <path d="M11.4 2.2a4.6 4.6 0 0 1 0 3" />
    </>
  ),
  roll: (
    <>
      <path d="M6 4.5h7.5" />
      <path d="M6 8h7.5" />
      <path d="M6 11.5h7.5" />
      <path d="M2.8 4.5h.4" />
      <path d="M2.8 8h.4" />
      <path d="M2.8 11.5h.4" />
    </>
  ),
  parts: (
    <>
      <path d="M8 2.5 13.5 5.3 8 8.1 2.5 5.3z" />
      <path d="M2.5 8.2 8 11l5.5-2.8" />
      <path d="M2.5 11 8 13.8l5.5-2.8" />
    </>
  ),
  news: (
    <>
      <path d="M3 4.5h8.5v8a1.5 1.5 0 0 0 1.5 1.5H4.5A1.5 1.5 0 0 1 3 12.5z" />
      <path d="M11.5 6.5h2v6a1 1 0 0 1-2 0" />
      <path d="M5 7h4.5" />
      <path d="M5 9.5h4.5" />
    </>
  ),
  repo: (
    <>
      <circle cx="4.5" cy="4" r="1.5" />
      <circle cx="4.5" cy="12" r="1.5" />
      <circle cx="11.5" cy="6" r="1.5" />
      <path d="M4.5 5.5v5" />
      <path d="M11.5 7.5c0 2.5-3 2-6.2 3.6" />
    </>
  ),
  key: (
    <>
      <circle cx="5.5" cy="10.5" r="3" />
      <path d="M7.6 8.4 13.5 2.5" />
      <path d="M11 5l2 2" />
    </>
  ),
  copy: (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M3.5 10.5h-.5a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 .5.5v.5" />
    </>
  ),
  check: <path d="M3.5 8.5l3 3 6-7" />,
  refresh: (
    <>
      <path d="M13 8a5 5 0 1 1-1.5-3.6" />
      <path d="M13 2.5v3h-3" />
    </>
  ),
  out: (
    <>
      <path d="M6.5 2.5h-3v11h3" />
      <path d="M10 5l3 3-3 3" />
      <path d="M13 8H6.5" />
    </>
  ),
  user: (
    <>
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M3 13.5c.6-2.4 2.6-3.8 5-3.8s4.4 1.4 5 3.8" />
    </>
  ),
  lock: (
    <>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
      <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" />
    </>
  ),
  external: (
    <>
      <path d="M9.5 2.5h4v4" />
      <path d="M13.5 2.5 7.5 8.5" />
      <path d="M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" />
    </>
  ),
  wrap: (
    <>
      <path d="M2.5 4h11" />
      <path d="M2.5 8h9a2 2 0 0 1 0 4H9" />
      <path d="M10.5 10.5 9 12l1.5 1.5" />
      <path d="M2.5 12h3.5" />
    </>
  ),
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof PATHS | 'play' | 'pause'

export function Icon({ name }: { name: IconName }) {
  if (name === 'play') {
    return (
      <svg className="i" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M5 3.2v9.6l7.6-4.8z" fill="currentColor" />
      </svg>
    )
  }
  if (name === 'pause') {
    return (
      <svg className="i" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="4" y="3.5" width="2.6" height="9" rx=".6" fill="currentColor" />
        <rect x="9.4" y="3.5" width="2.6" height="9" rx=".6" fill="currentColor" />
      </svg>
    )
  }
  return (
    <svg
      className="i"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}
