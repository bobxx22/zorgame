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
  onAir: number
  roll: RollEntry[] | null
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

function readWindow(value: unknown): EtherFrame['window'] | undefined {
  if (value === null) return null
  if (!isRecord(value) || timeMs(value.opensAt) === null || timeMs(value.closesAt) === null) return undefined
  return { opensAt: value.opensAt as string, closesAt: value.closesAt as string }
}

function readHarbinger(value: unknown): Harbinger | null | undefined {
  if (value === null) return null
  if (!isRecord(value) || !isCount(value.opensIn) || !isRecord(value.text)) return undefined
  const text: Record<string, string> = {}
  for (const [lang, line] of Object.entries(value.text)) {
    if (typeof line === 'string') text[lang] = line
  }
  if (Object.keys(text).length === 0) return undefined
  return { opensIn: value.opensIn, text }
}

function readFragment(value: unknown): Fragment | null | undefined {
  if (value === null) return null
  if (!isRecord(value) || !isCount(value.n) || !isCount(value.of) || typeof value.text !== 'string') return undefined
  if (value.n < 1 || value.n > value.of) return undefined
  return { n: value.n, of: value.of, text: value.text }
}

function readRoll(value: unknown): RollEntry[] | undefined {
  if (!Array.isArray(value)) return undefined
  const entries: RollEntry[] = []
  for (const item of value) {
    if (!isRecord(item) || !isCount(item.n) || !isCount(item.sinceOpen) || typeof item.name !== 'string') {
      return undefined
    }
    if (timeMs(item.at) === null) return undefined
    entries.push({ n: item.n, at: item.at as string, sinceOpen: item.sinceOpen, name: item.name })
  }
  return entries
}

/** Frame JSON after the seal is verified; unknown fields are ignored (CL-06). */
export function parseFrame(frame: string): EtherFrame | null {
  const json = parseJson(frame)
  if (!json || !isRecord(json.value)) return null
  const f = json.value
  if (f.v !== 1 || f.station !== 'zoria') return null
  if (f.kind !== 'signal' && f.kind !== 'roll') return null
  if (f.phase !== 'static' && f.phase !== 'window' && f.phase !== 'after') return null
  const atMs = timeMs(f.at)
  if (atMs === null || !isCount(f.onAir)) return null

  const window = readWindow(f.window)
  const harbinger = readHarbinger(f.harbinger ?? null)
  const fragment = readFragment(f.fragment ?? null)
  if (window === undefined || harbinger === undefined || fragment === undefined) return null

  let roll: RollEntry[] | null = null
  if (f.kind === 'roll') {
    const entries = readRoll(f.roll)
    if (!entries) return null
    roll = entries
  }

  return {
    v: 1,
    kind: f.kind,
    station: 'zoria',
    at: f.at as string,
    atMs,
    phase: f.phase,
    window,
    harbinger,
    fragment,
    onAir: f.onAir,
    roll,
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
