import type { EtherPhase } from '../ether/frame'
import type { Outcome } from '../ether/listener'
import type { KeyProblem } from '../ether/seal'

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
  unsupported: 'Браузер не підтримує Ed25519 у WebCrypto. Оновіть браузер (Chrome 137+, Firefox 129+, Safari 17+).',
}
