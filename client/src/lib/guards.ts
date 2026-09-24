/** Shape guards shared by every parser of server answers. */

export type Rec = Record<string, unknown>

export function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
