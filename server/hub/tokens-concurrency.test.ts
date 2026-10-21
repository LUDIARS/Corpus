import { afterEach, describe, expect, it, vi } from 'vitest';
import { CernereProjectTokenProvider } from './tokens.ts';

const target = { service: 'example', projectKey: 'example', baseUrl: 'https://example.test' };
const success = (): Response => Response.json({ accessToken: 'issued', expiresIn: 60 });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('project token issuance lifetime', () => {
  it('shares one issuance among 100 callers and normalizes audience', async () => {
    const fetcher = vi.fn(async () => success());
    vi.stubGlobal('fetch', fetcher);
    const provider = new CernereProjectTokenProvider('https://auth.test', () => 0);
    const results = await Promise.all(Array.from({ length: 100 }, (_, i) =>
      provider.getDownstreamToken('user', { ...target, baseUrl: target.baseUrl + (i % 2 ? '/' : '') })));
    expect(results).toEqual(Array(100).fill('issued'));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('separates user, project and audience and refreshes at the safety boundary', async () => {
    let now = 0;
    const fetcher = vi.fn(async () => success());
    vi.stubGlobal('fetch', fetcher);
    const provider = new CernereProjectTokenProvider('https://auth.test', () => now);
    await Promise.all([
      provider.getDownstreamToken('user', target),
      provider.getDownstreamToken('other', target),
      provider.getDownstreamToken('user', { ...target, projectKey: 'other' }),
      provider.getDownstreamToken('user', { ...target, baseUrl: 'https://other.test' }),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(4);
    now = 29_999;
    await provider.getDownstreamToken('user', target);
    expect(fetcher).toHaveBeenCalledTimes(4);
    now = 30_000;
    await provider.getDownstreamToken('user', target);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it('shares failures, clears in-flight state, and retries successfully', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('unreachable')).mockImplementation(async () => success());
    vi.stubGlobal('fetch', fetcher);
    const provider = new CernereProjectTokenProvider('https://auth.test');
    expect(await Promise.all(Array.from({ length: 100 }, () => provider.getDownstreamToken('user', target))))
      .toEqual(Array(100).fill(null));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await provider.getDownstreamToken('user', target)).toBe('issued');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, null, 0, -1, '60', Infinity, NaN])('rejects invalid TTL %s without caching', async (expiresIn) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetcher = vi.fn(async () => Response.json({ accessToken: 'issued', expiresIn }));
    vi.stubGlobal('fetch', fetcher);
    const provider = new CernereProjectTokenProvider('https://auth.test');
    expect(await provider.getDownstreamToken('user', target)).toBeNull();
    expect(await provider.getDownstreamToken('user', target)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('applies a finite timeout and releases timed-out issuance for retry', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const fetcher = vi.fn().mockImplementationOnce((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
      })).mockImplementation(async () => success());
    vi.stubGlobal('fetch', fetcher);
    const provider = new CernereProjectTokenProvider('https://auth.test');
    const pending = provider.getDownstreamToken('user', target);
    expect(timeout).toHaveBeenCalledWith(10_000);
    controller.abort();
    expect(await pending).toBeNull();
    expect(await provider.getDownstreamToken('user', target)).toBe('issued');
  });
});
