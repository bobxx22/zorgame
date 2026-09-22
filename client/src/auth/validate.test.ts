import { describe, expect, it } from 'vitest'
import {
  checkDisplayName,
  checkPassword,
  checkUsername,
  hasErrors,
  normalizeUsername,
  parseRepository,
  validateRegister,
} from './validate'

describe('parseRepository (CL-14)', () => {
  const accepted = [
    'bobxx22/zorgame',
    'github.com/bobxx22/zorgame',
    'https://github.com/bobxx22/zorgame',
    'http://github.com/bobxx22/zorgame',
    'https://www.github.com/bobxx22/zorgame',
    'www.github.com/bobxx22/zorgame',
    'https://github.com/bobxx22/zorgame/',
    'https://github.com/bobxx22/zorgame.git',
    'git@github.com:bobxx22/zorgame.git',
    '  bobxx22/zorgame  ',
  ]
  it.each(accepted)('accepts %s', (input) => {
    expect(parseRepository(input)).toMatchObject({ ok: true, slug: 'bobxx22/zorgame' })
  })

  const inside = [
    'https://github.com/bobxx22/zorgame/tree/main',
    'https://github.com/bobxx22/zorgame/blob/main/README.md',
    'https://github.com/bobxx22/zorgame/issues',
    'https://github.com/bobxx22/zorgame?tab=readme-ov-file',
    'https://github.com/bobxx22/zorgame#readme',
    'bobxx22/zorgame/pulls',
  ]
  it.each(inside)('refuses a link inside: %s', (input) => {
    expect(parseRepository(input)).toEqual({ ok: false, reason: 'inside' })
  })

  it('refuses other hosts and junk', () => {
    expect(parseRepository('https://gitlab.com/a/b')).toEqual({ ok: false, reason: 'not-github' })
    expect(parseRepository('gitlab.com/a/b')).toEqual({ ok: false, reason: 'not-github' })
    expect(parseRepository('zorgame')).toEqual({ ok: false, reason: 'invalid' })
    expect(parseRepository('https://github.com/bobxx22')).toEqual({ ok: false, reason: 'invalid' })
    expect(parseRepository('-bad/repo')).toEqual({ ok: false, reason: 'invalid' })
    expect(parseRepository('')).toEqual({ ok: false, reason: 'empty' })
  })

  it('keeps dots and dashes in the repository name', () => {
    expect(parseRepository('a-b/my.repo_1')).toMatchObject({ ok: true, url: 'https://github.com/a-b/my.repo_1' })
  })
})

describe('field checks (spec 5.6)', () => {
  it('username: 3-32, starts with a letter, case-insensitive', () => {
    expect(checkUsername('bobx')).toBeNull()
    expect(checkUsername('BobX')).toBeNull()
    expect(normalizeUsername(' BobX ')).toBe('bobx')
    expect(checkUsername('bo')).not.toBeNull()
    expect(checkUsername('1bob')).not.toBeNull()
    expect(checkUsername('bob.x')).not.toBeNull()
    expect(checkUsername('a'.repeat(33))).not.toBeNull()
  })

  it('display name: 1-80 characters of any script, no edge spaces, no line breaks', () => {
    expect(checkDisplayName('Північна вахта')).toBeNull()
    expect(checkDisplayName('ж'.repeat(80))).toBeNull()
    expect(checkDisplayName('')).not.toBeNull()
    expect(checkDisplayName(' name')).not.toBeNull()
    expect(checkDisplayName('a\tb')).not.toBeNull()
    expect(checkDisplayName('a'.repeat(81))).not.toBeNull()
  })

  it('password: 12-256 characters', () => {
    expect(checkPassword('correct-horse')).toBeNull()
    expect(checkPassword('short')).not.toBeNull()
    expect(checkPassword('x'.repeat(257))).not.toBeNull()
  })

  it('collects errors per field', () => {
    const errors = validateRegister({
      username: 'bobx',
      displayName: ' x',
      password: 'short',
      repository: 'https://github.com/bobxx22/zorgame/tree/main',
      lang: 'uk',
    })
    expect(Object.keys(errors).sort()).toEqual(['displayName', 'password', 'repository'])
    expect(hasErrors({})).toBe(false)
  })
})
