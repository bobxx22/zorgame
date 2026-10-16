import { describe, expect, it } from 'vitest'
import { aliasesOf, looseKey, parseField, standingOf, standingText } from './field'

/* the shapes of zoria.net/draw/groups.json and second-stage.json, cut down */
const GROUPS = {
  format: 'zaria-groups-v1',
  draw: { registered: 7 },
  struck: ['mrmozozavr', 'alice05star'],
  groups: [
    { group: 1, size: 3, members: ['bobx', 'matmik91', 'north'] },
    { group: 2, size: 2, members: ['yaroslav-h', 'mrwhoopee'] },
  ],
}
const SECOND = {
  format: 'zaria-second-stage-v1',
  items: [
    { n: 1, member: 'bobx', group: 1, place: 1, average: 8.25 },
    { n: 2, member: 'mrwhoopee', group: 2, place: 1, average: 8.75 },
  ],
}

describe('field: who went on, who left', () => {
  const parsed = parseField(GROUPS, SECOND)
  if (!parsed) throw new Error('the sample files did not parse')
  const field = parsed

  it('splits everyone registered into the second stage, the group stage and the struck', () => {
    expect(field.second).toEqual(['bobx', 'mrwhoopee'])
    expect(field.out).toEqual(['matmik91', 'north', 'yaroslav-h'])
    expect(field.struck).toEqual(['mrmozozavr', 'alice05star'])
    expect(field.registered).toBe(7)
    expect(field.byLogin.get('bobx')).toEqual({
      kind: 'second',
      group: 1,
      average: 8.25,
    })
    expect(field.byLogin.get('north')).toEqual({ kind: 'out', group: 1 })
    expect(field.byLogin.get('alice05star')).toEqual({ kind: 'struck' })
  })

  it("matches a roll name written differently from the login, and through the names of one's own games", () => {
    const aliases = aliasesOf(['TrustMeBro (matmik91)', 'Північна вахта (north)', 'klivak'])
    expect(standingOf(field, 'MrWhoopee', aliases)?.login).toBe('mrwhoopee')
    expect(standingOf(field, 'Yaroslav_H', aliases)?.login).toBe('yaroslav-h')
    expect(standingOf(field, 'TrustMeBro', aliases)).toEqual({
      login: 'matmik91',
      standing: { kind: 'out', group: 1 },
    })
    expect(standingOf(field, 'Північна вахта', aliases)?.login).toBe('north')
    expect(standingOf(field, 'Oleksandr Hal', aliases)).toBeNull()
  })

  it('refuses files of another shape and says each standing in words', () => {
    expect(parseField({}, SECOND)).toBeNull()
    expect(parseField(GROUPS, { items: 'none' })).toBeNull()
    expect(looseKey('Yaroslav_H')).toBe(looseKey('yaroslav-h'))
    expect(standingText({ kind: 'out', group: 3 })).toContain('група 3')
    expect(standingText({ kind: 'second', group: 1, average: 8.25 })).toContain('8.25')
  })
})
