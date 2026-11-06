import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completeServiceLogin } from './cernere-login.tsx';
const code = 'c'.repeat(43);
const verifier = 'v'.repeat(43);
const request = vi.fn();
const removeItem = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', request);
  vi.stubGlobal('localStorage', { removeItem });
  request.mockResolvedValue(Response.json({ ok: true, expiresAt: new Date(Date.now() + 890_000).toISOString() }));
});
afterEach(() => vi.unstubAllGlobals());
describe('browser project PKCE exchange', () => {
  it('sends code and verifier only to the same-origin service and clears old storage', async () => {
    await completeServiceLogin(code, verifier);
    expect(request).toHaveBeenCalledTimes(1);
    const [path, init] = request.mock.calls[0]!;
    expect(path).toBe('/auth/exchange');
    expect(init.credentials).toBe('same-origin');
    expect(init.redirect).toBe('error');
    expect(JSON.parse(init.body)).toEqual({ code, code_verifier: verifier });
    expect(removeItem).toHaveBeenCalledWith('corpus_token');
  });
  it.each([{ accessToken: 'global' }, { refreshToken: 'refresh' }, { projectToken: 'scoped' }, { sessionToken: 'opaque' }])('rejects credentials in a browser response', async credentials => {
    request.mockResolvedValueOnce(Response.json({ ok: true, expiresAt: new Date(Date.now() + 890_000).toISOString(), ...credentials }));
    await expect(completeServiceLogin(code, verifier)).rejects.toThrow();
    expect(removeItem).not.toHaveBeenCalled();
  });
  it('does not retry an exchange with an unknown outcome', async () => {
    request.mockRejectedValueOnce(new Error('timeout'));
    await expect(completeServiceLogin(code, verifier)).rejects.toThrow('timeout');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('rejects old code-only input and expired session metadata', async () => {
    await expect(completeServiceLogin(code, '')).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    request.mockResolvedValueOnce(Response.json({ ok: true, expiresAt: new Date(Date.now() - 1).toISOString() }));
    await expect(completeServiceLogin(code, verifier)).rejects.toThrow();
  });
  it('uses the UI lifetime signal for an exchange in flight', async () => {
    const lifetime = new AbortController();
    await completeServiceLogin(code, verifier, lifetime.signal);
    const signal = request.mock.calls[0]![1].signal as AbortSignal;
    lifetime.abort();
    expect(signal.aborted).toBe(true);
  });
});
