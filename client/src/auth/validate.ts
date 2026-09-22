/**
 * Field checks before sending (CL-13, spec 5.6) and repository address
 * parsing (CL-14). Messages are in Ukrainian: they are shown next to the field.
 */

export type Lang = 'uk' | 'en'

export interface RegisterForm {
  username: string
  displayName: string
  password: string
  /** One-time code from the application, field `invitation` (rules of 22.09). */
  invitation: string
  repository: string
  lang: Lang
}

export type FormField = keyof RegisterForm

export type FieldErrors = Partial<Record<FormField, string>>

/** Case does not matter; the contract pattern is lowercase. */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase()
}

const USERNAME = /^[a-z][a-z0-9_-]{2,31}$/

export function checkUsername(raw: string): string | null {
  const value = normalizeUsername(raw)
  if (value === '') return 'Вкажіть логін.'
  if (!/^[a-z]/.test(value)) return 'Логін починається з латинської літери.'
  if (value.length < 3 || value.length > 32) return 'Логін - від 3 до 32 знаків.'
  if (!USERNAME.test(value)) return 'Дозволено латинські літери, цифри, _ і -.'
  return null
}

/**
 * Length as the server most likely counts it (UTF-16 units). For Cyrillic and
 * Latin it equals the number of letters; an emoji counts as two, which only
 * makes the limit stricter, never looser.
 */
function charCount(value: string): number {
  return value.length
}

export function checkDisplayName(value: string): string | null {
  if (value === '') return 'Вкажіть відображуване ім’я.'
  if (/[\n\r\t]/.test(value)) return 'Без переведень рядка і табуляції.'
  if (value !== value.trim()) return 'Без пробілів на початку й у кінці.'
  if (charCount(value) > 80) return 'Не більше 80 знаків.'
  return null
}

export function checkPassword(value: string): string | null {
  const length = charCount(value)
  if (length < 12) return 'Пароль - щонайменше 12 знаків.'
  if (length > 256) return 'Пароль - не більше 256 знаків.'
  return null
}

/** The code comes from the organizers by mail or Telegram; the contract allows up to 100 characters. */
export function checkInvitation(value: string): string | null {
  const code = value.trim()
  if (code === '') return 'Вкажіть код заявки з листа організаторів.'
  if (code.length > 100) return 'Код заявки - не більше 100 знаків.'
  return null
}

export type RepositoryParse =
  | { ok: true; owner: string; repo: string; slug: string; url: string }
  | { ok: false; reason: 'empty' | 'too-long' | 'not-github' | 'inside' | 'invalid' }

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const REPO = /^[A-Za-z0-9._-]{1,100}$/

/**
 * Accepts owner/repo, a github.com address with or without scheme and www.,
 * the SSH form git@github.com:owner/repo.git, with .git or / at the end.
 * A link inside the repository (file, branch, tab, ?, #) is refused.
 */
export function parseRepository(raw: string): RepositoryParse {
  const input = raw.trim()
  if (input === '') return { ok: false, reason: 'empty' }
  if (input.length > 256) return { ok: false, reason: 'too-long' }
  if (/[?#]/.test(input)) return { ok: false, reason: 'inside' }

  let path: string
  const ssh = /^git@github\.com:(.+)$/i.exec(input)
  if (ssh) {
    path = ssh[1] ?? ''
  } else {
    const web = /^(?:https?:\/\/)?(?:www\.)?github\.com(?:\/(.*))?$/i.exec(input)
    if (web) {
      path = web[1] ?? ''
    } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input) || /^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\//i.test(input)) {
      return { ok: false, reason: 'not-github' }
    } else {
      path = input
    }
  }

  const parts = path.replace(/\/+$/, '').split('/')
  if (parts.length > 2) return { ok: false, reason: 'inside' }
  const [owner = '', repoRaw = ''] = parts
  const repo = repoRaw.replace(/\.git$/i, '')
  if (!OWNER.test(owner) || !REPO.test(repo) || repo === '.' || repo === '..') {
    return { ok: false, reason: 'invalid' }
  }
  const slug = `${owner}/${repo}`
  return { ok: true, owner, repo, slug, url: `https://github.com/${slug}` }
}

export const REPOSITORY_MESSAGE: Record<Exclude<RepositoryParse, { ok: true }>['reason'], string> = {
  empty: 'Вкажіть репозиторій із заявки.',
  'too-long': 'Адреса довша за 256 знаків.',
  'not-github': 'Потрібен репозиторій на github.com.',
  inside: 'Це посилання всередину репозиторію. Вкажіть адресу самого репозиторію: owner/repo.',
  invalid: 'Не схоже на репозиторій GitHub. Формат: owner/repo або https://github.com/owner/repo.',
}

export function checkRepository(raw: string): string | null {
  const parsed = parseRepository(raw)
  return parsed.ok ? null : REPOSITORY_MESSAGE[parsed.reason]
}

export function validateRegister(form: RegisterForm): FieldErrors {
  const errors: FieldErrors = {}
  const username = checkUsername(form.username)
  const invitation = checkInvitation(form.invitation)
  const displayName = checkDisplayName(form.displayName)
  const password = checkPassword(form.password)
  const repository = checkRepository(form.repository)
  if (username) errors.username = username
  if (invitation) errors.invitation = invitation
  if (displayName) errors.displayName = displayName
  if (password) errors.password = password
  if (repository) errors.repository = repository
  return errors
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0
}
