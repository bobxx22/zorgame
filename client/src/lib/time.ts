/**
 * The server speaks UTC only; the client shows local time and names the zone (CL-38).
 */

export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/** "UTC+3", "UTC-9:30", "UTC" for a given instant in a zone. */
export function utcOffsetLabel(at: Date, timeZone: string = localTimeZone()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(at)
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT'
  const offset = name.replace(/^GMT/, '')
  /* ICU 78 (Node 24.19, newer browsers) names UTC itself "GMT+00:00", older ones "GMT" */
  if (!offset || /^[+-]0?0(:00)?$/.test(offset)) return 'UTC'
  return 'UTC' + offset.replace(/^([+-])0?(\d+):00$/, '$1$2').replace(/^([+-])0?(\d+):(\d\d)$/, '$1$2:$3')
}

/** IANA renamed Europe/Kiev to Europe/Kyiv in 2022; Chrome on Windows still reports the old name. */
const RENAMED_ZONES: Readonly<Record<string, string>> = { 'Europe/Kiev': 'Europe/Kyiv' }

export function zoneName(timeZone: string = localTimeZone()): string {
  return RENAMED_ZONES[timeZone] ?? timeZone
}

export function zoneLabel(at: Date = new Date(), timeZone: string = localTimeZone()): string {
  return `${zoneName(timeZone)} (${utcOffsetLabel(at, timeZone)})`
}

/** Parses a server timestamp; null for missing or malformed values. */
export function parseServerTime(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : new Date(ms)
}

/** "5:59:12", "1 д 02:03:04", "0:00:07"; negative spans clamp to zero. */
/** Any moment the formatters take: a server timestamp, epoch ms or a Date; null when there is none. */
function toDate(value: Date | number | string | null | undefined): Date | null {
  if (typeof value === 'string') return parseServerTime(value)
  if (typeof value === 'number') return new Date(value)
  return value ?? null
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3_600)
  const minutes = Math.floor((total % 3_600) / 60)
  const seconds = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  const clock = `${days > 0 ? pad(hours) : String(hours)}:${pad(minutes)}:${pad(seconds)}`
  return days > 0 ? `${days} д ${clock}` : clock
}

export function formatLocalTime(value: Date | number, timeZone: string = localTimeZone(), locale = 'uk-UA'): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(value)
}

export function formatLocal(
  value: Date | number | string | null | undefined,
  timeZone: string = localTimeZone(),
  locale = 'uk-UA',
): string {
  const date = toDate(value)
  if (!date) return '—'
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

/** "24.09, 08:00" in the local zone: a moment where the year is obvious. */
export function formatDayTime(
  value: Date | number | string | null | undefined,
  timeZone: string = localTimeZone(),
  locale = 'uk-UA',
): string {
  const date = toDate(value)
  if (!date) return '—'
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

/** "24.09" in the local zone. */
export function formatDay(
  value: Date | number | string | null | undefined,
  timeZone: string = localTimeZone(),
  locale = 'uk-UA',
): string {
  const date = toDate(value)
  if (!date) return '—'
  return new Intl.DateTimeFormat(locale, { timeZone, day: '2-digit', month: '2-digit' }).format(date)
}

/** "2026-09-24 09:00:04 UTC": the form the organizers ask for when reporting an outage (spec 6). */
export function formatUtc(value: Date | number | string): string {
  const iso = new Date(value).toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`
}

/** "22.09.2026" in the local zone, as the site dates its announcements. */
export function formatDate(
  value: Date | number | string | null | undefined,
  timeZone: string = localTimeZone(),
  locale = 'uk-UA',
): string {
  const date = toDate(value)
  if (!date) return '—'
  return new Intl.DateTimeFormat(locale, { timeZone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)
}
