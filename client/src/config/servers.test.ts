import { describe, expect, it } from 'vitest'
import { availableServers, normalizeApiBase, PROD_KEY_FINGERPRINT, resolveServer, STAND_KEY_FINGERPRINT } from './servers'

const FP = 'f3a436df65614f08635f18fe0f64f145285203f1faa2905ecb25ffb90969a7de'

describe('normalizeApiBase', () => {
  it('strips trailing slashes', () => {
    expect(normalizeApiBase('https://zoria.net/api/v1/')).toBe('https://zoria.net/api/v1')
  })
  it('accepts localhost over http', () => {
    expect(normalizeApiBase('http://localhost:8080/api/v1')).toBe('http://localhost:8080/api/v1')
  })
  it('rejects non-http schemes, query and garbage', () => {
    expect(normalizeApiBase('ftp://zoria.net/api/v1')).toBeNull()
    expect(normalizeApiBase('https://zoria.net/api/v1?x=1')).toBeNull()
    expect(normalizeApiBase('not a url')).toBeNull()
  })
})

describe('resolveServer', () => {
  it('defaults to prod', () => {
    expect(resolveServer({}, null).apiBase).toBe('https://zoria.net/api/v1')
  })
  it('takes the env choice', () => {
    expect(resolveServer({ VITE_ZORIA_SERVER: 'stand' }, null).id).toBe('stand')
  })
  it('prefers the stored runtime choice over env', () => {
    expect(resolveServer({ VITE_ZORIA_SERVER: 'stand' }, 'prod').id).toBe('prod')
  })
  it('ignores unknown or unavailable choices', () => {
    expect(resolveServer({}, 'mars').id).toBe('prod')
    expect(resolveServer({}, 'custom').id).toBe('prod')
  })
  it('builds a custom server from env', () => {
    const s = resolveServer({ VITE_ZORIA_API_URL: 'http://localhost:8080/api/v1/' }, 'custom')
    expect(s).toMatchObject({ id: 'custom', apiBase: 'http://localhost:8080/api/v1' })
  })
  it('pins the published keys and lets env override them with a well-formed fingerprint', () => {
    expect(resolveServer({}, null).keyFingerprint).toBe(PROD_KEY_FINGERPRINT)
    expect(resolveServer({}, 'stand').keyFingerprint).toBe(STAND_KEY_FINGERPRINT)
    expect(resolveServer({ VITE_ZORIA_PROD_KEY_FINGERPRINT: FP.toUpperCase() }, null).keyFingerprint).toBe(FP)
    expect(resolveServer({ VITE_ZORIA_PROD_KEY_FINGERPRINT: 'abc' }, null).keyFingerprint).toBe(PROD_KEY_FINGERPRINT)
  })
  it('leaves a custom server unpinned unless env names its key', () => {
    const env = { VITE_ZORIA_API_URL: 'http://localhost:1/api/v1' }
    expect(resolveServer(env, 'custom').keyFingerprint).toBeNull()
    expect(resolveServer({ ...env, VITE_ZORIA_CUSTOM_KEY_FINGERPRINT: FP }, 'custom').keyFingerprint).toBe(FP)
  })
})

describe('availableServers', () => {
  it('lists custom only when configured', () => {
    expect(availableServers({}).map((s) => s.id)).toEqual(['prod', 'stand'])
    expect(availableServers({ VITE_ZORIA_API_URL: 'http://localhost:1' }).map((s) => s.id)).toEqual([
      'prod',
      'stand',
      'custom',
    ])
  })
})
