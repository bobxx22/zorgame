/**
 * Servers the client can talk to. The live server and the training stand are
 * switched at runtime or by env, without touching code (CL-40).
 */

export type ServerId = 'prod' | 'stand' | 'custom'

export interface ServerConfig {
  id: ServerId
  label: string
  apiBase: string
  /** SHA-256 of the station public key, 64 hex; null until published or for TOFU. */
  keyFingerprint: string | null
}

export interface ServerEnv {
  VITE_ZORIA_SERVER?: string | undefined
  VITE_ZORIA_API_URL?: string | undefined
  VITE_ZORIA_PROD_KEY_FINGERPRINT?: string | undefined
  VITE_ZORIA_STAND_KEY_FINGERPRINT?: string | undefined
  VITE_ZORIA_CUSTOM_KEY_FINGERPRINT?: string | undefined
}

const STORAGE_KEY = 'zoria.server'

const FINGERPRINT = /^[0-9a-f]{64}$/

function fingerprintOrNull(value: string | undefined): string | null {
  const v = value?.trim().toLowerCase()
  return v && FINGERPRINT.test(v) ? v : null
}

/** Trims the trailing slash; accepts only http(s) URLs. */
export function normalizeApiBase(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.search || url.hash) return null
  return url.origin + url.pathname.replace(/\/+$/, '')
}

export function buildServers(env: ServerEnv): Record<ServerId, ServerConfig | null> {
  const customBase = env.VITE_ZORIA_API_URL ? normalizeApiBase(env.VITE_ZORIA_API_URL) : null
  return {
    prod: {
      id: 'prod',
      label: 'Бойовий сервер',
      apiBase: 'https://zoria.net/api/v1',
      keyFingerprint: fingerprintOrNull(env.VITE_ZORIA_PROD_KEY_FINGERPRINT),
    },
    stand: {
      id: 'stand',
      label: 'Навчальний стенд',
      apiBase: 'https://stand.zoria.net/api/v1',
      keyFingerprint: fingerprintOrNull(env.VITE_ZORIA_STAND_KEY_FINGERPRINT),
    },
    custom: customBase
      ? {
          id: 'custom',
          label: 'Локальний сервер',
          apiBase: customBase,
          keyFingerprint: fingerprintOrNull(env.VITE_ZORIA_CUSTOM_KEY_FINGERPRINT),
        }
      : null,
  }
}

function isServerId(value: unknown): value is ServerId {
  return value === 'prod' || value === 'stand' || value === 'custom'
}

/** Runtime choice wins over env; env wins over the default (prod). */
export function resolveServer(env: ServerEnv, stored: string | null): ServerConfig {
  const servers = buildServers(env)
  for (const candidate of [stored, env.VITE_ZORIA_SERVER]) {
    if (isServerId(candidate)) {
      const server = servers[candidate]
      if (server) return server
    }
  }
  // prod is always defined by buildServers
  return servers.prod as ServerConfig
}

export function availableServers(env: ServerEnv): ServerConfig[] {
  return Object.values(buildServers(env)).filter((s): s is ServerConfig => s !== null)
}

export function readStoredServer(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function storeServer(id: ServerId): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // Storage may be unavailable (private mode); the choice then lasts until reload.
  }
}
