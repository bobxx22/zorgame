/* hq :: model/changes
   A value that changes over the ticks of a match, kept as the list of its
   changes: the ticks in ascending order and the value that holds from each one
   on. The whole show reads the world this way - who owns a needle, where a
   unit stands, what the bot believed - so a jump to any tick is a binary
   search, not a replay. */

export interface Changes<T> {
  readonly t: number[]
  readonly v: T[]
}

export function newChanges<T>(): Changes<T> {
  return { t: [], v: [] }
}

/** Records that the value is `v` from tick `t` on; a repeat of the current value is not a change. */
export function pushChange<T>(c: Changes<T>, t: number, v: T): void {
  const last = c.t.length - 1
  if (last >= 0 && c.v[last] === v) return
  if (last >= 0 && c.t[last] === t) {
    c.v[last] = v
    return
  }
  c.t.push(t)
  c.v.push(v)
}

/** Index of the last change no later than `t`, or -1 when the value was not known yet. */
export function indexAt(ticks: readonly number[], t: number): number {
  let lo = 0
  let hi = ticks.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if ((ticks[mid] as number) <= t) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return found
}

/** The value at tick `t`; `undefined` when there is no change no later than `t`. */
export function valueAt<T>(c: Changes<T> | undefined, t: number): T | undefined {
  if (!c) return undefined
  const i = indexAt(c.t, t)
  return i < 0 ? undefined : c.v[i]
}
