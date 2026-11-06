/** Browser holds only an opaque Corpus session, never a Cr token.
 * @implements SPEC-HUB-BOUND-SERVICE-SESSION
 */
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { CreatedServiceSession } from './service-session-store.ts';

function cookieName(secure: boolean): string { return secure ? '__Host-corpus_session' : 'corpus_session'; }
export function readServiceSessionCookie(c: Context, secure: boolean): string | null {
  return getCookie(c, cookieName(secure)) ?? null;
}
export function clearServiceSessionCookie(c: Context, secure: boolean): void {
  deleteCookie(c, cookieName(secure), { path: '/', secure, httpOnly: true, sameSite: 'Lax' });
  // Remove leftovers at cutover; these cookies are never accepted or refreshed.
  for (const legacy of ['cernere_token', 'cernere_refresh_token']) deleteCookie(c, legacy, { path: '/', secure });
}
export function persistServiceSessionCookie(c: Context, session: CreatedServiceSession, secure: boolean): void {
  const maxAge = Math.floor((Date.parse(session.expiresAt) - Date.now()) / 1000);
  if (!/^[A-Za-z0-9_-]{43}$/.test(session.token) || !Number.isFinite(maxAge) || maxAge <= 0 || maxAge > 900) {
    throw new Error('Invalid local service session cookie');
  }
  clearServiceSessionCookie(c, secure);
  setCookie(c, cookieName(secure), session.token, { path: '/', httpOnly: true, secure, sameSite: 'Lax', maxAge });
}
