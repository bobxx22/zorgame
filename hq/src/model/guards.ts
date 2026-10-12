/* hq :: model/guards
   Shape checks for what comes from outside the show: a pack summary, a diary line. */

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
