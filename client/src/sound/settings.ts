import { isRecord } from '../lib/guards'

/** The mixer's channels: everything, the event signals with the crackle, the station's voice. */
export type Channel = 'master' | 'signals' | 'voice'

export type Levels = Record<Channel, number>

export interface RadioSettings {
  signals: boolean
  voice: boolean
  /** 0..1 per channel; the master multiplies the other two. */
  levels: Levels
}

/** The master used to be a fixed 0.6: that stays the starting point. */
export const DEFAULT_LEVELS: Levels = { master: 0.6, signals: 1, voice: 1 }

export function clampLevel(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback
}

/** Settings kept by an earlier visit; anything missing or broken falls back to the defaults. */
export function readSettings(stored: unknown): RadioSettings {
  if (!isRecord(stored)) return { signals: true, voice: true, levels: { ...DEFAULT_LEVELS } }
  const levels = isRecord(stored.levels) ? stored.levels : {}
  return {
    signals: stored.signals !== false,
    voice: stored.voice !== false,
    levels: {
      master: clampLevel(levels.master, DEFAULT_LEVELS.master),
      signals: clampLevel(levels.signals, DEFAULT_LEVELS.signals),
      voice: clampLevel(levels.voice, DEFAULT_LEVELS.voice),
    },
  }
}
