const BASE64URL = /^[A-Za-z0-9_-]*$/

/** Unpadded base64url (RFC 4648, section 5); null for anything else. */
export function decodeBase64Url(input: string): Uint8Array<ArrayBuffer> | null {
  if (!BASE64URL.test(input) || input.length % 4 === 1) return null
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4)
  try {
    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', bytes))
}
