import type { AccessStatus, ReasonCode, Repository } from '../auth/schemas'

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

/**
 * Why the application is in its status: the client's text for a known code
 * with the server's own words beside it (they may name, say, the expected
 * GitHub account), or the server's text alone.
 */
export function reasonText(repository: Repository): string | null {
  const code = repository.reasonCode as ReasonCode | null
  const server = repository.reason?.trim() ?? ''
  if (code && code !== 'organizer' && code in REASON_TEXT) {
    const own = REASON_TEXT[code]
    return server && server !== own ? `${own} Сервер: «${server}»` : own
  }
  if (server) return server
  if (repository.accessStatus === 'pending') return 'Запрошення ще не прийнято.'
  return null
}
