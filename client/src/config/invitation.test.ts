import { describe, expect, it } from 'vitest'
import { invitationFor } from './invitation'

describe('invitationFor', () => {
  it('gives the code to the live server only', () => {
    expect(invitationFor('prod', ' abc ')).toBe('abc')
    expect(invitationFor('stand', 'abc')).toBe('')
    expect(invitationFor('custom', 'abc')).toBe('')
  })
  it('is empty without the variable', () => {
    expect(invitationFor('prod', undefined)).toBe('')
  })
})
