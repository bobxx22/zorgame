import sfxConfirm from '../assets/sound/sfx-confirm.mp3'
import sfxError from '../assets/sound/sfx-error.mp3'
import sfxHarbinger from '../assets/sound/sfx-harbinger.mp3'
import sfxLetter from '../assets/sound/sfx-letter.mp3'
import sfxStage from '../assets/sound/sfx-stage.mp3'
import sfxTick from '../assets/sound/sfx-tick.mp3'
import sfxVerified from '../assets/sound/sfx-verified.mp3'
import sfxWindow from '../assets/sound/sfx-window.mp3'
import voiceClosing from '../assets/sound/voice-closing.mp3'
import voiceHarbinger from '../assets/sound/voice-harbinger.mp3'
import voiceJammed from '../assets/sound/voice-jammed.mp3'
import voiceLetter from '../assets/sound/voice-letter.mp3'
import voiceLost from '../assets/sound/voice-lost.mp3'
import voiceNewStage from '../assets/sound/voice-new-stage.mp3'
import voiceRegistered from '../assets/sound/voice-registered.mp3'
import voiceVerified from '../assets/sound/voice-verified.mp3'
import voiceWindowOpen from '../assets/sound/voice-window-open.mp3'
import { readJson, writeJson } from '../lib/storage'
import type { Cue, SfxName, VoiceName } from './cues'
import { clampLevel, readSettings, type Channel, type RadioSettings } from './settings'

/**
 * The station's sound, built like the site's intro: a short crackle of
 * band-passed white noise (1700 Hz, Q 0.7) on a change of frame, a signal on an
 * event, the station's voice over it. No background. One switch for all, key M.
 */

const SFX: Record<SfxName, string> = {
  window: sfxWindow,
  harbinger: sfxHarbinger,
  tick: sfxTick,
  confirm: sfxConfirm,
  verified: sfxVerified,
  error: sfxError,
  letter: sfxLetter,
  stage: sfxStage,
}

const VOICE: Record<VoiceName, string> = {
  harbinger: voiceHarbinger,
  'window-open': voiceWindowOpen,
  registered: voiceRegistered,
  verified: voiceVerified,
  'new-stage': voiceNewStage,
  letter: voiceLetter,
  jammed: voiceJammed,
  lost: voiceLost,
  closing: voiceClosing,
}

/** A line that may come often is not repeated sooner than this. */
const VOICE_PAUSE_MS: Partial<Record<VoiceName, number>> = {
  jammed: 5 * 60_000,
  letter: 20_000,
  lost: 60_000,
}

/** The intro's crackle level, before the signals channel of the mixer. */
const CRACKLE_GAIN = 0.1
const STORAGE_KEY = 'zoria.sound'
/** A level change glides this fast instead of clicking. */
const LEVEL_GLIDE_S = 0.03

export interface RadioSnapshot extends RadioSettings {
  /** The browser lets the page play: there was a click or a key press. */
  unlocked: boolean
}

/** Both on unless switched off before; without storage the choice lasts until reload. */
function loadSettings(): RadioSettings {
  return readSettings(readJson(STORAGE_KEY))
}

function saveSettings(settings: RadioSettings): void {
  writeJson(STORAGE_KEY, settings)
}

/** master <- signals (the event sounds and the crackle), master <- voice. */
interface Mixer {
  master: GainNode
  signals: GainNode
  voice: GainNode
}

export class Radio {
  readonly #listeners = new Set<() => void>()
  readonly #buffers = new Map<string, Promise<AudioBuffer | null>>()
  readonly #lastVoice = new Map<VoiceName, number>()
  #snapshot: RadioSnapshot
  #ctx: AudioContext | null = null
  #mixer: Mixer | null = null
  #noise: AudioBuffer | null = null
  #voiceFreeAt = 0
  /** Settings before M silenced everything, to bring them back. */
  #beforeMute: Pick<RadioSettings, 'signals' | 'voice'> | null = null

  constructor() {
    this.#snapshot = { ...loadSettings(), unlocked: false }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  getSnapshot = (): RadioSnapshot => this.#snapshot

  /** Called on every click and key press: browsers start audio only after one. */
  unlock = (): void => {
    if (typeof AudioContext === 'undefined') return
    if (!this.#ctx) {
      const ctx = new AudioContext()
      const { levels } = this.#snapshot
      const master = ctx.createGain()
      master.gain.value = levels.master
      master.connect(ctx.destination)
      const signals = ctx.createGain()
      signals.gain.value = levels.signals
      signals.connect(master)
      const voice = ctx.createGain()
      voice.gain.value = levels.voice
      voice.connect(master)
      ctx.addEventListener('statechange', () => {
        this.#update({ unlocked: ctx.state === 'running' })
      })
      this.#ctx = ctx
      this.#mixer = { master, signals, voice }
    }
    if (this.#ctx.state === 'suspended') {
      this.#ctx.resume().catch(() => undefined)
    } else if (this.#ctx.state === 'running' && !this.#snapshot.unlocked) {
      this.#update({ unlocked: true })
    }
  }

  setSignals(on: boolean): void {
    this.#beforeMute = null
    this.#save({ signals: on })
  }

  setVoice(on: boolean): void {
    this.#beforeMute = null
    this.#save({ voice: on })
  }

  /** One fader of the mixer, 0..1; it glides so a drag never clicks. */
  setLevel(channel: Channel, value: number): void {
    const level = clampLevel(value, this.#snapshot.levels[channel])
    const node = this.#mixer?.[channel]
    if (node && this.#ctx) node.gain.setTargetAtTime(level, this.#ctx.currentTime, LEVEL_GLIDE_S)
    this.#save({ levels: { ...this.#snapshot.levels, [channel]: level } })
  }

  /** A short sample of a channel, to set its level by ear. */
  preview(channel: Channel): void {
    if (channel === 'voice') this.play({ voice: 'letter' }, { force: true })
    else this.play({ sfx: 'confirm' }, { force: true })
  }

  /** Key M: silence everything, or bring back what was on. */
  toggleAll(): void {
    const { signals, voice } = this.#snapshot
    if (signals || voice) {
      this.#beforeMute = { signals, voice }
      this.#save({ signals: false, voice: false })
    } else {
      this.#save(this.#beforeMute ?? { signals: true, voice: true })
      this.#beforeMute = null
    }
  }

  /** The crackle of a changing frame. */
  crackle(duration = 0.14): void {
    const ctx = this.#running()
    if (!ctx || !this.#mixer || !this.#snapshot.signals) return
    this.#noise ??= whiteNoise(ctx)
    const source = ctx.createBufferSource()
    source.buffer = this.#noise
    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 1700
    band.Q.value = 0.7
    const gain = ctx.createGain()
    const t = ctx.currentTime
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(CRACKLE_GAIN, t + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration)
    source.connect(band).connect(gain).connect(this.#mixer.signals)
    source.start(t, Math.random() * 0.5, duration + 0.05)
  }

  play(cue: Cue, options: { force?: boolean } = {}): void {
    const ctx = this.#running()
    if (!ctx || !this.#snapshot.signals) return
    const voice = cue.voice && this.#snapshot.voice && (options.force || this.#voiceDue(cue.voice)) ? cue.voice : null
    if (voice) this.#lastVoice.set(voice, Date.now())
    void this.#schedule(ctx, cue.sfx ?? null, voice)
  }

  async #schedule(ctx: AudioContext, sfx: SfxName | null, voice: VoiceName | null): Promise<void> {
    const [signal, line] = await Promise.all([
      sfx ? this.#load(ctx, SFX[sfx]) : null,
      voice ? this.#load(ctx, VOICE[voice]) : null,
    ])
    const now = ctx.currentTime
    if (signal) this.#start(ctx, signal, now, 'signals')
    if (line) {
      // The voice comes in over the tail of the signal and never over another line.
      const at = Math.max(now + (signal ? signal.duration * 0.7 : 0), this.#voiceFreeAt)
      this.#voiceFreeAt = at + line.duration + 0.25
      this.#start(ctx, line, at, 'voice')
    }
  }

  #start(ctx: AudioContext, buffer: AudioBuffer, at: number, channel: 'signals' | 'voice'): void {
    if (!this.#mixer) return
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(this.#mixer[channel])
    source.start(at)
  }

  #load(ctx: AudioContext, url: string): Promise<AudioBuffer | null> {
    let pending = this.#buffers.get(url)
    if (!pending) {
      pending = fetch(url)
        .then((response) => response.arrayBuffer())
        .then((bytes) => ctx.decodeAudioData(bytes))
        .catch(() => null)
      this.#buffers.set(url, pending)
    }
    return pending
  }

  #voiceDue(voice: VoiceName): boolean {
    const pause = VOICE_PAUSE_MS[voice]
    const last = this.#lastVoice.get(voice)
    return pause === undefined || last === undefined || Date.now() - last >= pause
  }

  #running(): AudioContext | null {
    return this.#ctx?.state === 'running' ? this.#ctx : null
  }

  #save(patch: Partial<RadioSettings>): void {
    const { signals, voice, levels } = { ...this.#snapshot, ...patch }
    saveSettings({ signals, voice, levels })
    this.#update(patch)
  }

  #update(patch: Partial<RadioSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...patch }
    for (const listener of this.#listeners) listener()
  }
}

function whiteNoise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return buffer
}
