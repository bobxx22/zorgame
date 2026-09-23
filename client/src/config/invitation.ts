import type { ServerId } from './servers'

/**
 * The application code from .env.local prefills the form, for the live server
 * only: the code is one-time, and a test on the stand must never spend it.
 */
export function invitationFor(serverId: ServerId | (string & {}), raw: string | undefined): string {
  return serverId === 'prod' ? (raw?.trim() ?? '') : ''
}

/**
 * Read by the dev server only (npm run dev). Vite writes env values into
 * bundles, so a build must not carry the one-time code: in a build the
 * condition is false and the value is cut out.
 */
export function envInvitation(serverId: ServerId | (string & {})): string {
  return import.meta.env.DEV ? invitationFor(serverId, import.meta.env.VITE_ZORIA_INVITATION) : ''
}
