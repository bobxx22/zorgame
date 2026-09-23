import { parseJson } from '../api/http'
import { verifySeal } from './seal'

/**
 * Ether envelope and frame (client spec 5.2). Order matters: form of the
 * envelope, key by id, seal over the raw frame string, and only then JSON of
 * the frame. The frame string is never re-serialized before the check.
 */

export type EtherPhase = 'static' | 'window' | 'after'

export interface Envelope {
  frame: string
  seal: string
  key: string
}

export interface Harbinger {
  opensIn: number
  /**
   * The station voice by language. The task text says Ukrainian and English,
   * the spec sample shows uk and ru: the client accepts any set of languages
   * and picks what it can show.
   */
  text: Readonly<Record<string, string>>
}

/** Voice for the participant: preferred language, then any other. */
export function voiceOf(text: Readonly<Record<string, string>>, prefer: readonly string[] = ['uk', 'en', 'ru']): string | null {
  for (const lang of prefer) {
    const value = text[lang]
    if (value) return value
  }
  return Object.values(text).find((value) => value !== '') ?? null
}

export interface Fragment {
  n: number
  of: number
  text: string
}

export interface RollEntry {
  n: number
  at: string
  sinceOpen: number
  name: string
}

export interface EtherFrame {
  v: 1
  kind: 'signal' | 'roll'
  station: 'zoria'
  at: string
  /** `at` as epoch ms. */
  atMs: number
  phase: EtherPhase
  window: { opensAt: string; closesAt: string } | null
  harbinger: Harbinger | null
  fragment: Fragment | null
  /** null when the station sent something that is not a count. */
  onAir: number | null
  roll: RollEntry[] | null
  /** Parts that did not parse and were dropped (the rest of the frame still counts). */
  damaged: readonly string[]
}

export type NoiseReason = 'broken' | 'unknown-key' | 'forged' | 'malformed-frame'

export type Reception =
  | { kind: 'signal'; frame: EtherFrame; keyId: string }
  | { kind: 'noise'; reason: NoiseReason }

const SEAL = /^[A-Za-z0-9_-]{86}$/
const KEY_ID = /^[0-9a-f]{16}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function timeMs(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

export function parseEnvelope(text: string): Envelope | null {
  const json = parseJson(text)
  if (!json || !isRecord(json.value)) return null
  const { frame, seal, key } = json.value
  if (typeof frame !== 'string' || typeof seal !== 'string' || typeof key !== 'string') return null
  if (!SEAL.test(seal) || !KEY_ID.test(key)) return null
  return { frame, seal, key }
}

/** A part that does not parse is dropped on its own; the frame is already proven by the seal. */
const BAD = Symbol('bad')

function readWindow(value: unknown): EtherFrame['window'] | typeof BAD {
  if (value === null || value === undefined) return null
  if (!isRecord(value) || timeMs(value.opensAt) === null || timeMs(value.closesAt) === null) return BAD
  return { opensAt: value.opensAt as string, closesAt: value.closesAt as string }
}

/** Only opensIn is mechanics; the voice is optional and may be empty (contract 1.1.0). */
function readHarbinger(value: unknown): Harbinger | null | typeof BAD {
  if (value === null || value === undefined) return null
  if (!isRecord(value) || !isCount(value.opensIn)) return BAD
  const text: Record<string, string> = {}
  if (isRecord(value.text)) {
    for (const [lang, line] of Object.entries(value.text)) {
      if (typeof line === 'string') text[lang] = line
    }
  }
  return { opensIn: value.opensIn, text }
}

function readFragment(value: unknown): Fragment | null | typeof BAD {
  if (value === null || value === undefined) return null
  if (!isRecord(value) || !isCount(value.n) || !isCount(value.of) || typeof value.text !== 'string') return BAD
  if (value.n < 1 || value.n > value.of) return BAD
  return { n: value.n, of: value.of, text: value.text }
}

/** Entries that do not parse are skipped one by one. */
function readRoll(value: unknown): { entries: RollEntry[]; skipped: boolean } | typeof BAD {
  if (!Array.isArray(value)) return BAD
  const entries: RollEntry[] = []
  let skipped = false
  for (const item of value) {
    if (
      !isRecord(item) ||
      !isCount(item.n) ||
      !isCount(item.sinceOpen) ||
      typeof item.name !== 'string' ||
      timeMs(item.at) === null
    ) {
      skipped = true
      continue
    }
    entries.push({ n: item.n, at: item.at as string, sinceOpen: item.sinceOpen, name: item.name })
  }
  return { entries, skipped }
}

/**
 * Frame JSON after the seal is verified. Only v, station, at and phase are
 * required: without them the frame says nothing. Every other part is read on
 * its own, and a part that does not parse is dropped and named in `damaged`
 * instead of losing the phase and the countdown with it. Unknown fields are
 * ignored (CL-06).
 */
export function parseFrame(frame: string): EtherFrame | null {
  const json = parseJson(frame)
  if (!json || !isRecord(json.value)) return null
  const f = json.value
  if (f.v !== 1 || f.station !== 'zoria') return null
  if (f.phase !== 'static' && f.phase !== 'window' && f.phase !== 'after') return null
  const atMs = timeMs(f.at)
  if (atMs === null) return null

  const damaged: string[] = []
  const window = readWindow(f.window)
  if (window === BAD) damaged.push('window')
  const harbinger = readHarbinger(f.harbinger)
  if (harbinger === BAD) damaged.push('harbinger')
  const fragment = readFragment(f.fragment)
  if (fragment === BAD) damaged.push('fragment')
  const onAir = isCount(f.onAir) ? f.onAir : null
  if (onAir === null) damaged.push('onAir')

  const kind = f.kind === 'roll' ? 'roll' : 'signal'
  let roll: RollEntry[] | null = null
  if (kind === 'roll') {
    const read = readRoll(f.roll)
    if (read === BAD) damaged.push('roll')
    else {
      roll = read.entries
      if (read.skipped) damaged.push('roll')
    }
  }

  return {
    v: 1,
    kind,
    station: 'zoria',
    at: f.at as string,
    atMs,
    phase: f.phase,
    window: window === BAD ? null : window,
    harbinger: harbinger === BAD ? null : harbinger,
    fragment: fragment === BAD ? null : fragment,
    onAir,
    roll,
    damaged,
  }
}

/**
 * Full check of one ether body. `keyFor` returns the station key for an id,
 * re-reading GET /ether/key once for an unknown id.
 */
export async function receive(text: string, keyFor: (id: string) => Promise<CryptoKey | null>): Promise<Reception> {
  const envelope = parseEnvelope(text)
  if (!envelope) return { kind: 'noise', reason: 'broken' }
  const key = await keyFor(envelope.key)
  if (!key) return { kind: 'noise', reason: 'unknown-key' }
  if (!(await verifySeal(key, envelope.frame, envelope.seal))) return { kind: 'noise', reason: 'forged' }
  const frame = parseFrame(envelope.frame)
  if (!frame) return { kind: 'noise', reason: 'malformed-frame' }
  return { kind: 'signal', frame, keyId: envelope.key }
}
