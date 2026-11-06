import { describe, expect, it, vi } from 'vitest';
import { CernereDelegationTokenProvider } from './tokens.ts';
import type { ServiceUserSession } from '../auth.ts';
const session: ServiceUserSession = { token: 's'.repeat(43), grant: { projectToken: 'source', sessionBinding: 'b'.repeat(43), projectKey: 'glab',
  user: { id: 'subject', role: 'member', displayName: 'User', email: null }, expiresAt: new Date(Date.now() + 600_000).toISOString() } };
describe('one-use delegation concurrency', () => {
  it('issues one capability for every operation and never shares cached/singleflight credentials', async () => {
    let counter = 0;
    const delegate = vi.fn(async () => ({ delegationToken: Buffer.alloc(32, ++counter).toString('base64url'),
      requestId: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`, expiresAt: new Date(Date.now() + 30_000).toISOString() }));
    const provider = new CernereDelegationTokenProvider({ delegate });
    const results = await Promise.all(Array.from({ length: 100 }, () => provider.authorize(session,
      { service: 'aedilis', projectKey: 'aedilis', baseUrl: 'https://aedilis.example' }, { path: '/records', action: 'records.read' })));
    expect(delegate).toHaveBeenCalledTimes(100);
    expect(new Set(results.map(result => new Headers(result!.init.headers).get('authorization'))).size).toBe(100);
  });
});
