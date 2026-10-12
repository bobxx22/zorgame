/* Types of the kit's guest wrapper (guest.js, HQ contract, section 2.6). */

export interface LiveStart {
  manifest: ArrayBuffer
  bots: string[]
  roster: string[]
  ticks: number
  seat: number
}

export interface LiveTick {
  t: number
  cap: number
  submits: [string, ArrayBuffer][]
  denies: [string, number, number][]
  belief: unknown
}

export interface LiveEnd {
  t: number
  shares: number[]
}

export interface PromoteResult {
  ok: boolean
  status: number
  detail: string
}

export interface ShowHost {
  readonly v: number
  readonly mode: 'record' | 'live' | 'none'
  readonly lang: 'uk' | 'en'
  packs(): unknown[]
  live(): LiveStart | null
  file(id: string, name: string): Promise<ArrayBuffer | string>
  cap(): number
  on(type: 'tick', fn: (tick: LiveTick) => void): () => void
  on(type: 'end', fn: (end: LiveEnd) => void): () => void
  on(type: 'lang', fn: (lang: 'uk' | 'en') => void): () => void
  ready(t: number): void
  promote(preset: string): Promise<PromoteResult>
}

/** Sets `window.ZARIA_HQ` at once; resolves when the feed has arrived or after two seconds of silence. */
export function openHost(opts?: { hq?: string; waitMs?: number }): Promise<ShowHost>

declare global {
  interface Window {
    ZARIA_HQ?: ShowHost
  }
}
