/**
 * The browser's storage, one way for the whole client. Storage may be missing
 * (private mode, a test run, blocked cookies) or full; then reads give null and
 * writes are dropped, and the value lives in memory until the page is closed.
 * Nothing secret is written here except an armed application, which lives in
 * this tab's sessionStorage only.
 */

export type StorageArea = 'local' | 'session'

function area(kind: StorageArea): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}

export function readText(key: string, kind: StorageArea = 'local'): string | null {
  try {
    return area(kind)?.getItem(key) ?? null
  } catch {
    return null
  }
}

/** Parsed JSON, or null when there is nothing or it does not parse. */
export function readJson(key: string, kind: StorageArea = 'local'): unknown {
  const raw = readText(key, kind)
  if (raw === null) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

/** Returns whether the value was stored. */
export function writeText(key: string, value: string, kind: StorageArea = 'local'): boolean {
  try {
    const storage = area(kind)
    storage?.setItem(key, value)
    return storage !== null
  } catch {
    return false
  }
}

export function writeJson(key: string, value: unknown, kind: StorageArea = 'local'): boolean {
  return writeText(key, JSON.stringify(value), kind)
}

export function removeKey(key: string, kind: StorageArea = 'local'): void {
  try {
    area(kind)?.removeItem(key)
  } catch {
    return
  }
}
