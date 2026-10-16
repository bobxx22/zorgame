/**
 * Who is still in the season: the public draw files of the site (zoria.net/draw/)
 * read against the roll. groups.json lists everyone registered, the struck ones
 * (not admitted) and the groups; second-stage.json lists who went on. Everyone
 * admitted and not in the second stage left in the group stage.
 *
 * The files name participants by login, the roll by display name, and nothing
 * public links the two. A roll name is matched when it is the login written
 * differently (case, spaces, dashes), or when one's own games named that person
 * with both (`Ім'я (login)`); otherwise the line stays unmarked.
 */
import { isRecord } from '../lib/guards'

export type Standing = { kind: 'second'; group: number; average: number } | { kind: 'out'; group: number } | { kind: 'struck' }

export interface Field {
  byLogin: ReadonlyMap<string, Standing>
  /** logins in the order of the files */
  second: readonly string[]
  out: readonly string[]
  struck: readonly string[]
  registered: number
}

/** A login or a name reduced to letters and digits: `Yaroslav_H` and `yaroslav-h` meet. */
export function looseKey(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** null when either file does not have the expected shape. */
export function parseField(groups: unknown, second: unknown): Field | null {
  if (!isRecord(groups) || !isRecord(second) || !Array.isArray(groups['groups']) || !Array.isArray(second['items'])) return null
  const byLogin = new Map<string, Standing>()
  const groupOf = new Map<string, number>()
  for (const g of groups['groups']) {
    if (!isRecord(g) || typeof g['group'] !== 'number') continue
    for (const login of strings(g['members'])) groupOf.set(login, g['group'])
  }
  const secondList: string[] = []
  for (const item of second['items']) {
    if (!isRecord(item) || typeof item['member'] !== 'string') continue
    const login = item['member']
    secondList.push(login)
    byLogin.set(login, {
      kind: 'second',
      group: typeof item['group'] === 'number' ? item['group'] : (groupOf.get(login) ?? 0),
      average: typeof item['average'] === 'number' ? item['average'] : 0,
    })
  }
  const out: string[] = []
  for (const [login, group] of groupOf) {
    if (byLogin.has(login)) continue
    byLogin.set(login, { kind: 'out', group })
    out.push(login)
  }
  const struck = strings(groups['struck']).filter((login) => !byLogin.has(login))
  for (const login of struck) byLogin.set(login, { kind: 'struck' })
  const draw = groups['draw']
  const registered = isRecord(draw) && typeof draw['registered'] === 'number' ? draw['registered'] : byLogin.size
  return { byLogin, second: secondList, out, struck, registered }
}

/**
 * Display name -> login from one's own games: the games screen writes an
 * opponent as `Name (login)` when the two differ.
 */
export function aliasesOf(opponents: readonly string[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const o of opponents) {
    const m = /^(.*) \(([^()]+)\)$/.exec(o)
    if (m?.[1] && m[2]) out.set(looseKey(m[1]), m[2])
  }
  return out
}

/** The login and the standing behind a roll name, or null when the name cannot be tied to a login. */
export function standingOf(field: Field, name: string, aliases: ReadonlyMap<string, string>): { login: string; standing: Standing } | null {
  const key = looseKey(name)
  const alias = aliases.get(key)
  if (alias) {
    const standing = field.byLogin.get(alias)
    if (standing) return { login: alias, standing }
  }
  for (const [login, standing] of field.byLogin) if (looseKey(login) === key) return { login, standing }
  return null
}

/** A line for a tooltip and for screen readers. */
export function standingText(s: Standing): string {
  if (s.kind === 'second') return `другий етап (група ${String(s.group)}, середня ${s.average.toFixed(2)})`
  if (s.kind === 'out') return `вибув у груповому етапі (група ${String(s.group)})`
  return 'не допущений до групового етапу'
}
