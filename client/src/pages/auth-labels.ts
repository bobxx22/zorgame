import type { AccessStatus, ReasonCode } from '../auth/schemas'

export const ACCESS_STATUS: Record<AccessStatus, { label: string; tone: 'ok' | 'warn' | 'err' }> = {
  pending: { label: 'очікує', tone: 'warn' },
  verified: { label: 'підтверджено', tone: 'ok' },
  'needs-attention': { label: 'потребує уваги', tone: 'err' },
}

/** Label for a status the client knows, undefined for a new one (shown as is). */
export function accessStatusOf(status: string): { label: string; tone: 'ok' | 'warn' | 'err' } | undefined {
  return (ACCESS_STATUS as Partial<Record<string, { label: string; tone: 'ok' | 'warn' | 'err' }>>)[status]
}

/** Client texts for machine reasons (CL-24); `organizer` shows the server text as is. */
export const REASON_TEXT: Record<Exclude<ReasonCode, 'organizer'>, string> = {
  'marker-found': 'Запрошення прийнято, файл .zoria називає ваш акаунт.',
  'marker-absent': 'Запрошення прийнято, але файлу .zoria в корені гілки за замовчуванням немає. Покладіть його.',
  'marker-other': 'Файл .zoria називає інший акаунт. Впишіть у нього свій логін.',
  'inviter-mismatch': 'Запрошення надіслав не той GitHub-акаунт, що вказано в заявці. Запросіть із нього.',
}

export const LOGIN_CODE_MESSAGE: Record<string, string> = {
  'invalid-credentials': 'Невірний логін або пароль.',
  'rate-limited': 'Забагато спроб входу. Зачекайте хвилину.',
  'session-limit': 'Забагато активних сесій цього акаунта.',
  timeout: 'Сервер не відповів вчасно.',
  network: 'Немає зв’язку з сервером.',
}
