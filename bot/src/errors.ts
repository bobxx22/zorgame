/* bot :: errors
   error text for the log: an Error - its message, anything else - as a string */

export function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
