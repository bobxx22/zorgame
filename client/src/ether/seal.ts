import { decodeBase64Url, sha256Hex } from './bytes'

/**
 * Station seal: Ed25519 (RFC 8032) over the UTF-8 bytes of the frame string
 * exactly as it arrived (client spec 5.2). The key comes from GET /ether/key
 * and is accepted only if its fingerprint checks out (CL-04).
 */

export interface StationKey {
  /** First 16 hex of the fingerprint; the `key` field of envelopes. */
  id: string
  /** SHA-256 of the 32 raw key bytes, 64 hex. */
  fingerprint: string
  /** 32 bytes, base64url. */
  publicKey: string
  cryptoKey: CryptoKey
}

export type KeyProblem =
  | 'malformed'
  | 'algorithm'
  | 'fingerprint-mismatch'
  | 'pinned-mismatch'
  | 'unsupported'
  | 'insecure'

export type KeyResult = { ok: true; key: StationKey } | { ok: false; problem: KeyProblem }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Checks a GET /ether/key body: Ed25519, 32-byte key, the fingerprint we compute
 * equals the one sent, `key` is its prefix, and it matches the published
 * fingerprint when one is pinned.
 */
export async function loadStationKey(body: unknown, pinnedFingerprint: string | null): Promise<KeyResult> {
  // WebCrypto exists only in a secure context (https, localhost, a file): over plain http from an IP it is gone.
  if (typeof crypto === 'undefined' || (crypto as Partial<Crypto>).subtle === undefined) {
    return { ok: false, problem: 'insecure' }
  }
  if (!isRecord(body)) return { ok: false, problem: 'malformed' }
  const { algorithm, key, publicKey, fingerprint } = body
  if (algorithm !== 'Ed25519') return { ok: false, problem: 'algorithm' }
  if (typeof key !== 'string' || typeof publicKey !== 'string' || typeof fingerprint !== 'string') {
    return { ok: false, problem: 'malformed' }
  }
  const raw = decodeBase64Url(publicKey)
  if (raw?.length !== 32) return { ok: false, problem: 'malformed' }

  const computed = await sha256Hex(raw)
  if (fingerprint.toLowerCase() !== computed || key.toLowerCase() !== computed.slice(0, 16)) {
    return { ok: false, problem: 'fingerprint-mismatch' }
  }
  if (pinnedFingerprint !== null && pinnedFingerprint !== computed) {
    return { ok: false, problem: 'pinned-mismatch' }
  }

  try {
    const cryptoKey = await crypto.subtle.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify'])
    return { ok: true, key: { id: computed.slice(0, 16), fingerprint: computed, publicKey, cryptoKey } }
  } catch {
    // Ed25519 in WebCrypto: Chrome 137+, Firefox 129+, Safari 17.4+, Node 22+
    return { ok: false, problem: 'unsupported' }
  }
}

/** True only for a valid seal over the frame bytes as received; never throws. */
export async function verifySeal(key: CryptoKey, frame: string, seal: string): Promise<boolean> {
  const signature = decodeBase64Url(seal)
  if (signature?.length !== 64) return false
  try {
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, signature, new TextEncoder().encode(frame))
  } catch {
    return false
  }
}
