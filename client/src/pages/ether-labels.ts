import type { EtherPhase } from '../ether/frame'
import type { Outcome } from '../ether/listener'
import type { KeyProblem } from '../ether/seal'
import type { StationState } from '../ether/station'
import type { SceneName } from '../ui/scenes'

export const PHASE_LABEL: Record<EtherPhase, string> = {
  static: 'Шум',
  window: 'Просвіт',
  after: 'Після просвіту',
}

export type Tone = 'ok' | 'muted' | 'warn' | 'err'

export const OUTCOME: Record<Outcome, { label: string; tone: Tone }> = {
  signal: { label: 'сигнал', tone: 'ok' },
  echo: { label: 'ехо або затримка', tone: 'muted' },
  forged: { label: 'підробка', tone: 'warn' },
  broken: { label: 'битий кадр', tone: 'warn' },
  'no-envelope': { label: 'чужа відповідь', tone: 'warn' },
  'unknown-key': { label: 'невідомий ключ', tone: 'warn' },
  'malformed-frame': { label: 'кадр не за схемою', tone: 'warn' },
  jammed: { label: 'глушіння', tone: 'err' },
  'rate-limited': { label: 'ліміт', tone: 'err' },
  network: { label: 'обрив', tone: 'err' },
  timeout: { label: 'тайм-аут', tone: 'err' },
  'key-ok': { label: 'ключ прийнято', tone: 'ok' },
  'key-rejected': { label: 'ключ відхилено', tone: 'err' },
  'key-failed': { label: 'ключ недоступний', tone: 'err' },
}

export const KEY_PROBLEM: Record<KeyProblem | 'unavailable', string> = {
  unavailable: 'Ключ станції поки недоступний: сервер не відповів. Спробуємо ще, коли прийде кадр.',
  malformed: 'Сервер віддав ключ неправильної форми. Кадрам без перевіреного ключа клієнт не вірить.',
  algorithm: 'Ключ не Ed25519. Такий ключ клієнт не приймає.',
  'fingerprint-mismatch': 'Відбиток ключа не сходиться з самим ключем. Ключ відхилено.',
  'pinned-mismatch': 'Відбиток ключа не збігається з опублікованим у ТЗ. Ключ відхилено.',
  unsupported: 'Браузер не підтримує Ed25519 у WebCrypto. Оновіть браузер (Chrome 137+, Firefox 129+, Safari 17.4+).',
  insecure:
    'Сторінку відкрито не із захищеного джерела (http з IP-адреси): браузер вимикає криптографію, і печатку не перевірити. Відкрийте клієнт через localhost, https або файлом.',
}

/** How the station looks right now: the phase, with the harbinger as a look of its own. */
export type Look = 'unknown' | 'static' | 'harbinger' | 'window' | 'after'

export function lookOf(station: StationState): Look {
  if (station.phase === null) return 'unknown'
  if (station.phase === 'static') return station.opensAtMs !== null ? 'harbinger' : 'static'
  return station.phase
}

export const LOOK_LABEL: Record<Look, string> = {
  unknown: 'Слухаємо',
  static: 'Шум',
  harbinger: 'Провісник',
  window: 'Просвіт',
  after: 'Після просвіту',
}

export const LOOK_SCENE: Record<Look, SceneName> = {
  unknown: 'static',
  static: 'static',
  harbinger: 'harbinger',
  window: 'window',
  after: 'after',
}

/** The count the station runs now: to the opening, or to the closing of the window. */
export function lookCountdown(station: StationState, serverNowMs: number): { label: string; ms: number } | null {
  if (station.phase === 'static' && station.opensAtMs !== null) {
    return { label: 'до просвіту', ms: station.opensAtMs - serverNowMs }
  }
  if (station.phase === 'window' && station.window) {
    return { label: 'до закриття', ms: station.window.closesAtMs - serverNowMs }
  }
  return null
}
