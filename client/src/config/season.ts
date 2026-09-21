/** Dates of the season from the part 1 task text (UTC). */
export const SEASON = {
  /** The window starts somewhere in this range and lasts at least 10 h. */
  windowEarliest: '2026-09-24T05:00:00.000Z',
  windowLatest: '2026-09-25T09:00:00.000Z',
  /** accessStatus must be "verified" by then. */
  accessDeadline: '2026-10-05T21:00:00.000Z',
  part2: '2026-09-28',
} as const

/** GitHub account named in the task text; the server's /public/config is the authority. */
export const ORGANIZER_GITHUB = 'zoria-net-bot'
