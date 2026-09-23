import type { RollEntry } from '../ether/frame'

/** Registration and its roll line are stamped by the same request: they differ by a moment at most. */
const SAME_MOMENT_MS = 2_000

/**
 * The participant's own line of the roll. Display names are not unique, so
 * the time of registration decides and the name only breaks a tie; a name
 * alone is trusted only when nobody else carries it.
 */
export function findOwnEntry(
  entries: readonly RollEntry[],
  user: { createdAt: string; displayName: string },
): RollEntry | undefined {
  const created = Date.parse(user.createdAt)
  const near = Number.isNaN(created)
    ? []
    : entries.filter((entry) => Math.abs(Date.parse(entry.at) - created) <= SAME_MOMENT_MS)
  const byName = (list: readonly RollEntry[]) => list.filter((entry) => entry.name === user.displayName)
  if (near.length > 0) return byName(near)[0] ?? (near.length === 1 ? near[0] : undefined)
  const named = byName(entries)
  return named.length === 1 ? named[0] : undefined
}
