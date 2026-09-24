import { describe, expect, it } from 'vitest'
import type * as Ours from '../auth/schemas'
import type * as Cabinet from '../cabinet/schemas'
import type { EtherFrame, RollEntry } from '../ether/frame'
import type * as Contract from './types'

/**
 * The hand-written shapes against the generated contract (api/part1.openapi.yaml),
 * checked by the compiler: every value a field may take by the contract must
 * fit our type of that field, or `npm run typecheck` fails with the field's
 * name. A nullable field read as a plain string (as News.publishedAt once
 * was) is caught here, not by a participant with an empty news feed.
 */
type Uncovered<Mine, Theirs> = {
  [K in keyof Mine & keyof Theirs]-?: [Theirs[K]] extends [Mine[K]] ? never : K
}[keyof Mine & keyof Theirs]

function covers<Mine, Theirs>(ok: [Uncovered<Mine, Theirs>] extends [never] ? true : Uncovered<Mine, Theirs>): boolean {
  return ok === true
}

describe('hand-written shapes cover the contract', () => {
  it('holds at compile time; the calls only make it visible in the test report', () => {
    const checks = [
      covers<Ours.User, Contract.User>(true),
      covers<Ours.Session, Contract.Session>(true),
      covers<Ours.Repository, Contract.Repository>(true),
      covers<Cabinet.Summary, Contract.Summary>(true),
      covers<Cabinet.News, Contract.News>(true),
      // notice is a union with an open variant in the contract; its guard reads it field by field
      covers<Omit<Cabinet.Message, 'notice'>, Omit<Contract.Message, 'notice'>>(true),
      covers<Cabinet.StageSummary, Contract.StageSummary>(true),
      covers<Cabinet.Stage, Contract.Stage>(true),
      covers<RollEntry, Contract.RollEntry>(true),
      // harbinger.text is optional in the contract and roll may be absent: the frame parser reads both part by part
      // atMs and damaged are ours, derived; only our side is narrowed, as Omit would flatten
      // the contract frame's index signature
      covers<Omit<EtherFrame, 'harbinger' | 'roll' | 'atMs' | 'damaged'>, Contract.Frame>(true),
    ]
    expect(checks.every(Boolean)).toBe(true)
  })
})
