/** Joins class names, skipping the falsy ones. */
export function cls(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}
