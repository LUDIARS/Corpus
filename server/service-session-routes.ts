/** Same-origin browser exchange and separate native bearer exchange.
 * @implements SPEC-HUB-BOUND-SERVICE-SESSION
 */
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { CompositeAuthorityError } from '../lib/cernere/packages/composite/src/service-session.js';
import { clearServiceSessionCookie, persistServiceSessionCookie, readServiceSessionCookie } from './service-session-cookie.ts';
import { ServiceSessionRotationError, type ServiceSessionStore } from './service-session-store.ts';

type SessionStore = Pick<ServiceSessionStore, 'create' | 'revoke'>;
export function makeServiceSessionRoutes(store: SessionStore, publicOrigin: string): Hono {
  const origin = new URL(publicOrigin);
  if (origin.origin !== publicOrigin || origin.username || origin.password || !(origin.protocol === 'https:'
    || (origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))) {
    throw new Error('Service session routes require the configured HTTPS or loopback origin');
  }
  const secure = origin.protocol === 'https:';
  const router = new Hono();
  for (const path of ['/auth/exchange', '/auth/logout', '/api/auth/native/exchange', '/api/auth/native/logout']) {
    router.use(path, async (c, next) => { c.header('Cache-Control', 'private, no-store'); await next(); }, bodyLimit({ maxSize: 4096 }));
  }

  const allowedOrigin = (c: Context, native: boolean): boolean => {
    const supplied = c.req.header('origin');
    return supplied === publicOrigin || (native && supplied === undefined);
  };
  async function exchange(c: Context, native: boolean): Promise<Response> {
    if (!allowedOrigin(c, native)) return c.json({ error: 'invalid_session_origin' }, 403);
    if (c.req.header('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      return c.json({ error: 'json_required' }, 415);
    }
    let input: unknown;
    try { input = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return c.json({ error: 'invalid_exchange' }, 400);
    const { code, code_verifier: verifier } = input as Record<string, unknown>;
    if (Object.keys(input).some(key => key !== 'code' && key !== 'code_verifier') || typeof code !== 'string'
      || !/^[A-Za-z0-9_-]{43}$/.test(code) || typeof verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) {
      return c.json({ error: 'code_and_s256_verifier_required' }, 400);
    }
    try {
      const previousToken = native ? (/^Bearer ([A-Za-z0-9_-]{43})$/.exec(c.req.header('authorization') ?? '')?.[1])
        : readServiceSessionCookie(c, secure) ?? undefined;
      const session = await store.create(code, verifier, previousToken);
      if (native) return c.json({ sessionToken: session.token, expiresAt: session.expiresAt });
      persistServiceSessionCookie(c, session, secure);
      return c.json({ ok: true, expiresAt: session.expiresAt });
    } catch (error) {
      if (error instanceof ServiceSessionRotationError) {
        clearServiceSessionCookie(c, secure);
        return c.json({ error: 'session_rotation_unconfirmed', localSessionEnded: true }, 503);
      }
      return c.json({ error: 'service_session_exchange_failed' }, error instanceof CompositeAuthorityError && error.status < 500 ? 401 : 503);
    }
  }
  async function logout(c: Context, native: boolean): Promise<Response> {
    if (!allowedOrigin(c, native)) return c.json({ error: 'invalid_session_origin' }, 403);
    const authorization = c.req.header('authorization') ?? '';
    const token = native ? (/^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization)?.[1] ?? null) : readServiceSessionCookie(c, secure);
    if (!native) clearServiceSessionCookie(c, secure);
    if (native && !token) return c.json({ error: 'service_session_required' }, 401);
    try {
      if (token) await store.revoke(token);
      return c.json({ ok: true });
    } catch {
      // Local state was deleted first; report the unconfirmed remote result explicitly.
      return c.json({ error: 'revocation_unconfirmed', localSessionEnded: true }, 503);
    }
  }
  router.post('/auth/exchange', c => exchange(c, false));
  router.post('/auth/logout', c => logout(c, false));
  router.post('/api/auth/native/exchange', c => exchange(c, true));
  router.post('/api/auth/native/logout', c => logout(c, true));
  return router;
}
