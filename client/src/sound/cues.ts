import type { EtherPhase } from '../ether/frame'

/**
 * Which station event deserves a sound. Sound marks an event, it is never a
 * background: the same rule as the site's intro. Only changes seen while the
 * tab is open count; what was already true when the page loaded stays quiet.
 */

export type SfxName = 'window' | 'harbinger' | 'tick' | 'confirm' | 'verified' | 'error' | 'letter' | 'stage'

export type VoiceName =
  | 'harbinger'
  | 'window-open'
  | 'registered'
  | 'verified'
  | 'new-stage'
  | 'letter'
  | 'jammed'
  | 'lost'
  | 'closing'

export interface Cue {
  sfx?: SfxName
  voice?: VoiceName
}

/** What the station sounds watch, reduced to plain values. */
export interface Watch {
  phase: EtherPhase | null
  opensAtMs: number | null
  /** Jams and rate limits seen by the listener so far. */
  jams: number
  registered: boolean
  lost: boolean
  /** accessStatus of the application; null until read. */
  access: string | null
  /** Summary counters; null until the summary is read. */
  released: number | null
  unread: number | null
  /** Window open, no session, little time left. */
  closingSoon: boolean
}

/** Less than this to the end of the window without a session: the station warns once. */
export const CLOSING_WARNING_MS = 15 * 60_000

export function detectCues(prev: Watch | null, next: Watch): Cue[] {
  if (!prev) return []
  const cues: Cue[] = []

  if (next.phase === 'window' && prev.phase !== null && prev.phase !== 'window') {
    cues.push({ sfx: 'window', voice: 'window-open' })
  } else if (next.phase === 'static' && prev.phase !== null && next.opensAtMs !== null && prev.opensAtMs === null) {
    cues.push({ sfx: 'harbinger', voice: 'harbinger' })
  }

  if (next.registered && !prev.registered) cues.push({ sfx: 'confirm', voice: 'registered' })

  if (next.access === 'verified' && prev.access !== null && prev.access !== 'verified') {
    cues.push({ sfx: 'verified', voice: 'verified' })
  }

  // A new part comes with its own letter: one announcement is enough.
  if (next.released !== null && prev.released !== null && next.released > prev.released) {
    cues.push({ sfx: 'stage', voice: 'new-stage' })
  } else if (next.unread !== null && prev.unread !== null && next.unread > prev.unread) {
    cues.push({ sfx: 'letter', voice: 'letter' })
  }

  if (next.lost && !prev.lost) cues.push({ sfx: 'error', voice: 'lost' })
  if (next.jams > prev.jams) cues.push({ sfx: 'error', voice: 'jammed' })
  if (next.closingSoon && !prev.closingSoon) cues.push({ sfx: 'harbinger', voice: 'closing' })

  return cues
}

/** Seconds left to show a tick for: the last ten before the window opens. */
export function tickSecond(opensAtMs: number | null, serverNowMs: number): number | null {
  if (opensAtMs === null) return null
  const left = Math.ceil((opensAtMs - serverNowMs) / 1000)
  return left >= 1 && left <= 10 ? left : null
}
