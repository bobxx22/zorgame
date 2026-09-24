import { readText, writeText } from '../lib/storage'

/**
 * Servers the client can talk to. The live server and the training stand are
 * switched at runtime or by env, without touching code (CL-40).
 */

export type ServerId = 'prod' | 'stand' | 'custom'

export interface ServerConfig {
  id: ServerId
  label: string
  apiBase: string
  /** SHA-256 of the station public key, 64 hex; null only for a custom server without one (TOFU). */
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

/** Published in the part 1 task text, section 3 (23.09); SHA-256 of the raw key (CL-04). */
export const PROD_KEY_FINGERPRINT = 'dcb3155eb8f2538d466a294315e984fa9f67f703556c5e276d5b3afc88895696' // gitleaks:allow public, from the task text
/** The stand's key is constant (client spec, section 6); its GET /ether/key gives this one. */
export const STAND_KEY_FINGERPRINT = 'd8860c95b821dc56c0f44a2f0b22f3e157af83bfaed9e55206ac5109d4230a1a' // gitleaks:allow public

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
      keyFingerprint: fingerprintOrNull(env.VITE_ZORIA_PROD_KEY_FINGERPRINT) ?? PROD_KEY_FINGERPRINT,
    },
    stand: {
      id: 'stand',
      label: 'Навчальний стенд',
      apiBase: 'https://stand.zoria.net/api/v1',
      keyFingerprint: fingerprintOrNull(env.VITE_ZORIA_STAND_KEY_FINGERPRINT) ?? STAND_KEY_FINGERPRINT,
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
  return readText(STORAGE_KEY)
}

/** Without storage (private mode) the choice lasts until reload. */
export function storeServer(id: ServerId): void {
  writeText(STORAGE_KEY, id)
}
