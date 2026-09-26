/**
 * Offers the new password to the browser's password manager. The network has
 * no password change (a lost one is replaced only by a code from the
 * organizers), and an armed application is sent by a button, not a submitted
 * form, so the browser would not offer it by itself.
 * Where the Credential Management API is missing nothing happens.
 */
export function rememberPassword(username: string, password: string, displayName: string): void {
  const Credential = (window as { PasswordCredential?: new (data: { id: string; password: string; name?: string }) => Credential })
    .PasswordCredential
  if (!Credential || !username || !password) return
  try {
    void navigator.credentials.store(new Credential({ id: username, password, name: displayName })).catch(() => undefined)
  } catch {
    return
  }
}
