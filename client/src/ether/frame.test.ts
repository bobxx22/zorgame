import { beforeAll, describe, expect, it } from 'vitest'
import { decodeBase64Url } from './bytes'
import {
  FRAME_A,
  FRAME_B,
  FRAME_C,
  FRAME_D,
  signalFrame,
  TRAINING_FINGERPRINT,
  TRAINING_KEY_BODY,
  TRAINING_KEY_ID,
  testStation,
  type TestStation,
} from './fixtures'
import { parseEnvelope, parseFrame, receive } from './frame'
import { loadStationKey, verifySeal } from './seal'

async function trainingKey(): Promise<CryptoKey> {
  const result = await loadStationKey(TRAINING_KEY_BODY, TRAINING_FINGERPRINT)
  if (!result.ok) throw new Error(result.problem)
  return result.key.cryptoKey
}

let station: TestStation
let stationKey: CryptoKey

beforeAll(async () => {
  station = await testStation()
  const loaded = await loadStationKey(station.body, station.fingerprint)
  if (!loaded.ok) throw new Error(loaded.problem)
  stationKey = loaded.key.cryptoKey
})

const keyFor = async (id: string) =>
  id === TRAINING_KEY_ID ? trainingKey() : id === station.id ? stationKey : null

describe('decodeBase64Url', () => {
  it('decodes unpadded base64url and rejects other alphabets', () => {
    expect(decodeBase64Url('_-8')).toEqual(new Uint8Array([0xff, 0xef]))
    expect(decodeBase64Url('a+b/')).toBeNull()
    expect(decodeBase64Url('abcde')).toBeNull()
  })
})

describe('loadStationKey', () => {
  it('accepts the training key and derives the id', async () => {
    const result = await loadStationKey(TRAINING_KEY_BODY, TRAINING_FINGERPRINT)
    expect(result.ok && result.key.id).toBe(TRAINING_KEY_ID)
  })
  it('accepts an unpinned key whose fingerprint checks out', async () => {
    expect((await loadStationKey(TRAINING_KEY_BODY, null)).ok).toBe(true)
  })
  it('rejects a key that does not match the pinned fingerprint', async () => {
    expect(await loadStationKey(TRAINING_KEY_BODY, 'a'.repeat(64))).toEqual({ ok: false, problem: 'pinned-mismatch' })
  })
  it('rejects a body whose fingerprint lies about the key', async () => {
    expect(await loadStationKey({ ...TRAINING_KEY_BODY, fingerprint: 'b'.repeat(64) }, null)).toEqual({
      ok: false,
      problem: 'fingerprint-mismatch',
    })
    expect(await loadStationKey({ ...TRAINING_KEY_BODY, key: '0'.repeat(16) }, null)).toEqual({
      ok: false,
      problem: 'fingerprint-mismatch',
    })
  })
  it('rejects other algorithms and junk', async () => {
    expect(await loadStationKey({ ...TRAINING_KEY_BODY, algorithm: 'RSA' }, null)).toEqual({
      ok: false,
      problem: 'algorithm',
    })
    expect(await loadStationKey('<html>', null)).toEqual({ ok: false, problem: 'malformed' })
    expect(await loadStationKey({ ...TRAINING_KEY_BODY, publicKey: 'AAAA' }, null)).toEqual({
      ok: false,
      problem: 'malformed',
    })
  })
})

describe('reference frames A-D (spec 5.2)', () => {
  it('A is a signal: static, harbinger opening at 09:00Z, fragment 3/12', async () => {
    const r = await receive(FRAME_A, keyFor)
    expect(r.kind).toBe('signal')
    if (r.kind !== 'signal') return
    expect(r.frame.phase).toBe('static')
    expect(r.frame.atMs + (r.frame.harbinger?.opensIn ?? 0) * 1000).toBe(Date.parse('2026-09-24T09:00:00Z'))
    expect(r.frame.fragment).toEqual({ n: 3, of: 12, text: 'навчальний уривок' })
  })
  it('B is forged', async () => {
    expect(await receive(FRAME_B, keyFor)).toEqual({ kind: 'noise', reason: 'forged' })
  })
  it('C is broken and does not throw', async () => {
    expect(await receive(FRAME_C, keyFor)).toEqual({ kind: 'noise', reason: 'broken' })
  })
  it('D is a signal with two roll entries', async () => {
    const r = await receive(FRAME_D, keyFor)
    expect(r.kind === 'signal' && r.frame.roll?.map((e) => e.name)).toEqual(['Північна вахта', 'Stitch'])
  })
})

describe('receive', () => {
  it('checks the seal over the frame bytes as they arrived', async () => {
    const envelope = parseEnvelope(FRAME_A)
    if (!envelope) throw new Error('A must parse')
    const key = await trainingKey()
    expect(await verifySeal(key, envelope.frame, envelope.seal)).toBe(true)
    // Same JSON, re-serialized: different bytes, so the seal no longer holds.
    const reserialized = JSON.stringify(JSON.parse(envelope.frame), null, 1)
    expect(await verifySeal(key, reserialized, envelope.seal)).toBe(false)
  })

  it('treats an unknown key id as noise', async () => {
    const other = FRAME_A.replace(`"key":"${TRAINING_KEY_ID}"`, '"key":"0123456789abcdef"')
    expect(await receive(other, keyFor)).toEqual({ kind: 'noise', reason: 'unknown-key' })
  })

  it('treats API-like errors, HTML and empty bodies as broken', async () => {
    for (const body of ['{"error":{"code":"repository-not-eligible"}}', '<html></html>', '', 'null', '[]']) {
      expect(await receive(body, keyFor)).toEqual({ kind: 'noise', reason: 'broken' })
    }
  })

  it('ignores unknown fields in the envelope and in the frame (CL-06)', async () => {
    const sealed = JSON.parse(await station.seal(signalFrame({ extra: { deep: true } }))) as Record<string, unknown>
    const r = await receive(JSON.stringify({ ...sealed, future: 1 }), keyFor)
    expect(r.kind).toBe('signal')
  })

  it('rejects a sealed frame of the wrong station or version', async () => {
    expect(await receive(await station.seal(signalFrame({ station: 'other' })), keyFor)).toEqual({
      kind: 'noise',
      reason: 'malformed-frame',
    })
    expect(await receive(await station.seal(signalFrame({ v: 2 })), keyFor)).toEqual({
      kind: 'noise',
      reason: 'malformed-frame',
    })
  })
})

describe('parseFrame', () => {
  it('rejects a fragment number outside 1..of and a negative opensIn', () => {
    const base = signalFrame({})
    expect(parseFrame(JSON.stringify({ ...base, fragment: { n: 0, of: 12, text: 'x' } }))).toBeNull()
    expect(parseFrame(JSON.stringify({ ...base, harbinger: { opensIn: -1, text: { uk: '', ru: '' } } }))).toBeNull()
  })
  it('treats missing optional parts as null', () => {
    const rest = signalFrame({})
    delete rest.harbinger
    delete rest.fragment
    expect(parseFrame(JSON.stringify(rest))).toMatchObject({ harbinger: null, fragment: null })
  })
})
