import { describe, expect, it } from 'vitest';
import { DownstreamTokenCache } from './token-cache.ts';

describe('DownstreamTokenCache', () => {
  it('expires at the thirty-second safety boundary on reads and writes', () => {
    let now = 0;
    const cache = new DownstreamTokenCache(() => now);
    cache.set('a', 'token', 60_000);
    now = 29_999;
    expect(cache.get('a')).toBe('token');
    now = 30_000;
    expect(cache.get('a')).toBeUndefined();
    cache.set('b', 'expired', 60_000);
    expect(cache.get('b')).toBeUndefined();
  });

  it('evicts earliest expiry, not insertion order, beyond 1024 entries', () => {
    const cache = new DownstreamTokenCache(() => 0);
    cache.set('long', 'long', 999_999);
    for (let i = 0; i < 1024; i++) cache.set(String(i), String(i), 60_000 + i);
    expect(cache.get('long')).toBe('long');
    expect(cache.get('0')).toBeUndefined();
    expect(cache.get('1')).toBe('1');
    expect(cache.get('1023')).toBe('1023');
  });
});
