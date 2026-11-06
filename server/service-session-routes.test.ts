import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeServiceSessionRoutes } from './service-session-routes.ts';
import { ServiceSessionRotationError } from './service-session-store.ts';
const ORIGIN = 'https://glab.example';
const code = 'c'.repeat(43);
const verifier = 'v'.repeat(43);
const token = 's'.repeat(43);
const store = { create: vi.fn(), revoke: vi.fn() };
beforeEach(() => {
  vi.resetAllMocks();
  store.create.mockResolvedValue({ token, expiresAt: new Date(Date.now() + 890_000).toISOString() });
  store.revoke.mockResolvedValue(undefined);
});
function exchange(path = '/auth/exchange', origin: string | null = ORIGIN, body: unknown = { code, code_verifier: verifier }) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (origin !== null) headers.origin = origin;
  return makeServiceSessionRoutes(store, ORIGIN).request(path, { method: 'POST', headers, body: JSON.stringify(body) });
}
describe('service session HTTP boundary', () => {
  it('sets only an opaque Secure HttpOnly SameSite cookie for browser exchange', async () => {
    const result = await exchange();
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toEqual({ ok: true, expiresAt: expect.any(String) });
    const cookies = result.headers.get('set-cookie') ?? '';
    expect(cookies).toContain(`__Host-corpus_session=${token}`);
    expect(cookies).toContain('HttpOnly');
    expect(cookies).toContain('Secure');
    expect(cookies).toContain('SameSite=Lax');
    expect(cookies).toContain('Path=/');
    expect(cookies).not.toContain('Domain=');
    expect(result.headers.get('cache-control')).toBe('private, no-store');
    expect(store.create).toHaveBeenCalledWith(code, verifier, undefined);
  });
  it.each([null, 'null', 'https://other.example'])('rejects browser CSRF/missing origin %s before exchanging a code', async origin => {
    expect((await exchange('/auth/exchange', origin)).status).toBe(403);
    expect(store.create).not.toHaveBeenCalled();
  });
  it.each([{ code }, { code, code_verifier: 'short' }, { code, code_verifier: verifier, projectToken: 'injected' }])('rejects incomplete or mixed contracts', async body => {
    expect((await exchange('/auth/exchange', ORIGIN, body)).status).toBe(400);
    expect(store.create).not.toHaveBeenCalled();
  });
  it('rejects non-JSON and oversized requests', async () => {
    const app = makeServiceSessionRoutes(store, ORIGIN);
    expect((await app.request('/auth/exchange', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'text/plain' }, body: '{}' })).status).toBe(415);
    expect((await app.request('/auth/exchange', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: 'x'.repeat(5000) })).status).toBe(413);
    expect(store.create).not.toHaveBeenCalled();
  });
  it('returns an opaque bearer only to the separate native exchange', async () => {
    const response = await exchange('/api/auth/native/exchange', null);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sessionToken: token, expiresAt: expect.any(String) });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect((await exchange('/api/auth/native/exchange', 'https://other.example')).status).toBe(403);
  });
  it('passes the previous opaque cookie for rotation without accepting legacy Cr cookies', async () => {
    const app = makeServiceSessionRoutes(store, ORIGIN);
    await app.request('/auth/exchange', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', cookie: `__Host-corpus_session=${token}; cernere_token=old-global` }, body: JSON.stringify({ code, code_verifier: verifier }) });
    expect(store.create).toHaveBeenCalledWith(code, verifier, token);
  });
  it('rotates native sessions only using the explicit native bearer, never a cookie', async () => {
    const app = makeServiceSessionRoutes(store, ORIGIN);
    await app.request('/api/auth/native/exchange', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ code, code_verifier: verifier }) });
    expect(store.create).toHaveBeenCalledWith(code, verifier, token);
  });
  it('clears the browser cookie on an unconfirmed rotation and never returns a replacement', async () => {
    store.create.mockRejectedValueOnce(new ServiceSessionRotationError());
    const response = await exchange();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'session_rotation_unconfirmed', localSessionEnded: true });
    expect(response.headers.get('set-cookie')).toContain('__Host-corpus_session=;');
  });
  it('clears local browser state even if remote revocation is unconfirmed', async () => {
    store.revoke.mockRejectedValueOnce(new Error('unreachable'));
    const response = await makeServiceSessionRoutes(store, ORIGIN).request('/auth/logout', { method: 'POST', headers: { origin: ORIGIN, cookie: `__Host-corpus_session=${token}` } });
    expect(response.status).toBe(503);
    expect(response.headers.get('set-cookie')).toContain('__Host-corpus_session=;');
    expect(await response.json()).toEqual({ error: 'revocation_unconfirmed', localSessionEnded: true });
    expect(store.revoke).toHaveBeenCalledWith(token);
  });
  it('requires the native bearer and never uses an ambient browser cookie for native logout', async () => {
    const app = makeServiceSessionRoutes(store, ORIGIN);
    const missing = await app.request('/api/auth/native/logout', { method: 'POST', headers: { cookie: `__Host-corpus_session=${token}` } });
    expect(missing.status).toBe(401);
    expect(store.revoke).not.toHaveBeenCalled();
    const response = await app.request('/api/auth/native/logout', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(store.revoke).toHaveBeenCalledWith(token);
  });
  it('requires a canonical configured origin and an explicit loopback HTTP exception', () => {
    expect(() => makeServiceSessionRoutes(store, 'https://glab.example/path')).toThrow();
    expect(() => makeServiceSessionRoutes(store, 'http://glab.example')).toThrow();
    expect(() => makeServiceSessionRoutes(store, 'http://localhost:5185')).not.toThrow();
  });
});
