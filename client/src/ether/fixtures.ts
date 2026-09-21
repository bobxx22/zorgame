import { sha256Hex } from './bytes'

/**
 * Training public key and reference frames A-D from the client spec, section 5.2.
 * Frames of our own are sealed with a throwaway key generated per test run, so
 * no private key material ever lands in the repository.
 */

export const TRAINING_PUBLIC_KEY = 'GQgsc8G1w5aXEnExpTBE597_7acc0vGKMAT5wUW4L5g'
export const TRAINING_FINGERPRINT = 'f3a436df65614f08635f18fe0f64f145285203f1faa2905ecb25ffb90969a7de'
export const TRAINING_KEY_ID = 'f3a436df65614f08'

export const TRAINING_KEY_BODY = {
  algorithm: 'Ed25519',
  key: TRAINING_KEY_ID,
  publicKey: TRAINING_PUBLIC_KEY,
  fingerprint: TRAINING_FINGERPRINT,
}

/** A: real, static, harbinger 6 h with a voice, fragment 3/12. Opens 2026-09-24T09:00:00Z. */
export const FRAME_A = String.raw`{"frame":"{\"v\":1,\"kind\":\"signal\",\"station\":\"zoria\",\"at\":\"2026-09-24T03:00:00.000Z\",\"phase\":\"static\",\"window\":null,\"harbinger\":{\"opensIn\":21600,\"text\":{\"uk\":\"...тріск... у шумі несуча... слабка, рівна... хтось тримає канал...\",\"ru\":\"...треск... в шуме несущая... слабая, ровная... кто-то держит канал...\"}},\"fragment\":{\"n\":3,\"of\":12,\"text\":\"навчальний уривок\"},\"onAir\":0}","seal":"NEcYfpe3oNX3SMBFWWFgWbkhLGKIoLELoaQn62BtuElLU213zmgzXBUPtQbJMhGf4jxbPjIf9oKXIFOpuYrgCw","key":"f3a436df65614f08"}`

/** B: forged false window; the seal does not match. */
export const FRAME_B = String.raw`{"frame":"{\"v\":1,\"kind\":\"signal\",\"station\":\"zoria\",\"at\":\"2026-09-24T03:00:05.000Z\",\"phase\":\"window\",\"window\":{\"opensAt\":\"2026-09-24T02:40:00.000Z\",\"closesAt\":\"2026-09-24T13:10:00.000Z\"},\"harbinger\":null,\"fragment\":null,\"onAir\":17}","seal":"tyynPbJxE4itFop4uKs0W9TL1CRfwHNZ3HHBFFknbihg4I403hmaEL9MDcboucrllUmeKvJQfr70eHKBPLJfAg","key":"f3a436df65614f08"}`

/** C: broken, the first 120 characters of A. */
export const FRAME_C = FRAME_A.slice(0, 120)

/** D: real roll in the window, two entries. */
export const FRAME_D = String.raw`{"frame":"{\"v\":1,\"kind\":\"roll\",\"station\":\"zoria\",\"at\":\"2026-09-24T09:05:00.000Z\",\"phase\":\"window\",\"window\":{\"opensAt\":\"2026-09-24T09:00:00.000Z\",\"closesAt\":\"2026-09-24T19:00:00.000Z\"},\"harbinger\":null,\"fragment\":null,\"onAir\":2,\"roll\":[{\"n\":1,\"at\":\"2026-09-24T09:00:04.311Z\",\"sinceOpen\":4,\"name\":\"Північна вахта\"},{\"n\":2,\"at\":\"2026-09-24T09:01:30.020Z\",\"sinceOpen\":90,\"name\":\"Stitch\"}]}","seal":"_y5ZQ4FXV2BUeuWxFXFAzVcg1ygpokZElCv-eQvT88JzAiPlUvJUg6wlKYTd-6Ihv9VFkbYlZCJmbb_aAQ9OAA","key":"f3a436df65614f08"}`

export interface TestStation {
  id: string
  fingerprint: string
  /** GET /ether/key body for this station. */
  body: { algorithm: 'Ed25519'; key: string; publicKey: string; fingerprint: string }
  /** Seals a frame object and returns the envelope text. */
  seal(frame: Record<string, unknown>): Promise<string>
}

function toBase64Url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/** A station with a freshly generated Ed25519 key that lives only in memory. */
export async function testStation(): Promise<TestStation> {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  const fingerprint = await sha256Hex(raw)
  const id = fingerprint.slice(0, 16)
  return {
    id,
    fingerprint,
    body: { algorithm: 'Ed25519', key: id, publicKey: toBase64Url(raw.buffer), fingerprint },
    async seal(frame) {
      const text = JSON.stringify(frame)
      const signature = await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(text))
      return JSON.stringify({ frame: text, seal: toBase64Url(signature), key: id })
    },
  }
}

export function signalFrame(patch: Record<string, unknown>): Record<string, unknown> {
  return {
    v: 1,
    kind: 'signal',
    station: 'zoria',
    at: '2026-09-24T03:00:00.000Z',
    phase: 'static',
    window: null,
    harbinger: null,
    fragment: null,
    onAir: 0,
    ...patch,
  }
}
