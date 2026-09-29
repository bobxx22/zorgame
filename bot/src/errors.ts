/* bot :: errors
   текст помилки для журналу: Error - її повідомлення, решта - як рядок */

export function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
