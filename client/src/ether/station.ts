import type { EtherFrame, EtherPhase, Harbinger, RollEntry } from './frame'

/**
 * What the client knows about the station, built only from verified frames.
 * Pure reducer: echo and delayed frames (old `at`) never roll the phase back
 * (CL-05); the countdown runs on the server clock (CL-11); the Keeper's letter
 * is assembled by fragment number, repeats dropped (CL-35).
 */

export interface StationState {
  /** Newest verified frame by `at`. */
  latest: EtherFrame | null
  phase: EtherPhase | null
  /** Window opening by the server clock (`at` + opensIn), while the harbinger is heard. */
  opensAtMs: number | null
  harbingerText: Harbinger['text'] | null
  window: { opensAtMs: number; closesAtMs: number } | null
  onAir: number | null
  /** Server clock minus local clock, ms; best of recent samples. */
  clockOffsetMs: number | null
  offsetSamples: readonly number[]
  fragments: Readonly<Record<number, string>>
  fragmentsOf: number | null
  roll: { entries: readonly RollEntry[]; atMs: number } | null
  signals: number
  echoes: number
}

export const OFFSET_SAMPLES = 10

export const initialStation: StationState = {
  latest: null,
  phase: null,
  opensAtMs: null,
  harbingerText: null,
  window: null,
  onAir: null,
  clockOffsetMs: null,
  offsetSamples: [],
  fragments: {},
  fragmentsOf: null,
  roll: null,
  signals: 0,
  echoes: 0,
}

/**
 * `at` is stamped when the frame is issued; delay and latency only make a
 * sample smaller, so the largest recent sample is the closest to the truth.
 */
function withOffset(state: StationState, frame: EtherFrame, receivedAtMs: number): Pick<StationState, 'offsetSamples' | 'clockOffsetMs'> {
  const offsetSamples = [...state.offsetSamples, frame.atMs - receivedAtMs].slice(-OFFSET_SAMPLES)
  return { offsetSamples, clockOffsetMs: Math.max(...offsetSamples) }
}

function withFragment(state: StationState, frame: EtherFrame): Pick<StationState, 'fragments' | 'fragmentsOf'> {
  const { fragment } = frame
  const unchanged = { fragments: state.fragments, fragmentsOf: state.fragmentsOf }
  if (!fragment) return unchanged
  if (state.fragmentsOf !== null && state.fragmentsOf !== fragment.of) return unchanged
  if (fragment.n in state.fragments) return unchanged
  return { fragments: { ...state.fragments, [fragment.n]: fragment.text }, fragmentsOf: fragment.of }
}

export function applyFrame(state: StationState, frame: EtherFrame, receivedAtMs: number): StationState {
  const next: StationState = {
    ...state,
    ...withOffset(state, frame, receivedAtMs),
    ...withFragment(state, frame),
    signals: state.signals + 1,
  }

  if (frame.roll && (!state.roll || frame.atMs > state.roll.atMs)) {
    next.roll = { entries: frame.roll, atMs: frame.atMs }
  }

  const isNewest = !state.latest || frame.atMs > state.latest.atMs
  if (!isNewest) return { ...next, echoes: state.echoes + 1 }

  const harbinger = frame.phase === 'static' ? frame.harbinger : null
  return {
    ...next,
    latest: frame,
    phase: frame.phase,
    opensAtMs: harbinger ? frame.atMs + harbinger.opensIn * 1000 : null,
    harbingerText: harbinger ? harbinger.text : null,
    window: frame.window
      ? { opensAtMs: Date.parse(frame.window.opensAt), closesAtMs: Date.parse(frame.window.closesAt) }
      : null,
    onAir: frame.onAir,
  }
}

/** Server-clock now, from the local clock and the estimated offset. */
export function serverNow(state: StationState, localNowMs: number): number {
  return localNowMs + (state.clockOffsetMs ?? 0)
}

/** Assembled letter: fragments in order, null for the gaps. */
export function letter(state: StationState): (string | null)[] {
  if (state.fragmentsOf === null) return []
  return Array.from({ length: state.fragmentsOf }, (_, i) => state.fragments[i + 1] ?? null)
}
