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
  if (!offset) return 'UTC'
  return 'UTC' + offset.replace(/^([+-])0?(\d+):00$/, '$1$2').replace(/^([+-])0?(\d+):(\d\d)$/, '$1$2:$3')
}

export function zoneLabel(at: Date = new Date(), timeZone: string = localTimeZone()): string {
  return `${timeZone} (${utcOffsetLabel(at, timeZone)})`
}

/** Parses a server timestamp; null for missing or malformed values. */
export function parseServerTime(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : new Date(ms)
}

export function formatLocal(
  value: Date | string | null | undefined,
  timeZone: string = localTimeZone(),
  locale = 'uk-UA',
): string {
  const date = typeof value === 'string' ? parseServerTime(value) : (value ?? null)
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
