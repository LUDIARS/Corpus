import { describe, expect, it, vi } from 'vitest';
import { ServiceSessionStore } from './service-session-store.ts';
import type { BoundServiceSession, ResourceOperation, ServiceOperation } from '../lib/cernere/packages/composite/src/service-session.js';
import type { ScopedIdentitySession } from '../lib/cernere/packages/composite/src/service-identity.js';

function fixture(capacity = 10_000) {
  let now = Date.now();
  let entropy = 1;
  const user = { id: 'subject', role: 'member', displayName: 'Person', email: null };
  const grant: BoundServiceSession = { projectToken: 'scoped-project-token', sessionBinding: 'binding', projectKey: 'glab', user,
    expiresAt: new Date(now + 900_000).toISOString() };
  const authority = {
    exchange: vi.fn(async (_code: string, _verifier: string) => ({ projectToken: grant.projectToken, user })),
    delegations: { issue: vi.fn(async () => ({ delegationToken: 't'.repeat(43), requestId: '22222222-2222-4222-8222-222222222222', expiresAt: new Date(now + 30_000).toISOString() })) },
    identity: { organizations: vi.fn(async (_owner: ScopedIdentitySession) => []), faceConsentStatus: vi.fn(async () => []),
      createFaceConsent: vi.fn(async () => {}), revokeFaceConsent: vi.fn(async () => {}) },
    sessions: {
      bind: vi.fn(async (_token: string, _secret: string) => ({ ...grant })),
      check: vi.fn(async (session: BoundServiceSession) => ({ ...session })),
      revoke: vi.fn(async (_session: BoundServiceSession) => {}),
      run: async <T>(_session: BoundServiceSession, _operation: ServiceOperation, resource: ResourceOperation<T>): Promise<T> => {
        if (!await resource.authorizeResource({ risk: resource.risk, requestId: _operation.requestId ?? '22222222-2222-4222-8222-222222222222' })) throw new Error('resource denied');
        return resource.execute();
      },
    },
  };
  const store = new ServiceSessionStore(authority, 'glab', () => now, () => Buffer.alloc(32, entropy++).toString('base64url'), capacity);
  return { store, authority, grant, advance: (ms: number) => { now += ms; } };
}
describe('Corpus opaque service sessions', () => {
  it('provides a current local owner to scoped identity calls without a global credential escape', async () => {
    const { store, authority } = fixture();
    const created = await store.create('code', 'verifier');
    expect(await store.organizations(created.token)).toEqual([]);
    const owner = authority.identity.organizations.mock.calls[0]?.[0];
    expect(owner?.isCurrent()).toBe(true);
    await store.revoke(created.token);
    expect(() => owner?.isCurrent()).toThrow();
    await expect(store.organizations(created.token)).rejects.toThrow();
    expect(authority.identity.organizations).toHaveBeenCalledOnce();
  });
  it('delivers only a random local credential after scoped exchange and binding', async () => {
    const { store, authority } = fixture();
    const created = await store.create('code', 'verifier');
    expect(created).toEqual({ token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), expiresAt: expect.any(String) });
    expect(created).not.toHaveProperty('projectToken');
    expect(created).not.toHaveProperty('accessToken');
    expect(created).not.toHaveProperty('refreshToken');
    expect(authority.exchange).toHaveBeenCalledTimes(1);
    expect(authority.exchange).toHaveBeenCalledWith('code', 'verifier');
    expect(authority.sessions.bind).toHaveBeenCalledTimes(1);
    expect(authority.sessions.bind).toHaveBeenCalledWith('scoped-project-token', created.token);
  });
  it('asks the authority on every request and never reuses a positive cached answer', async () => {
    const { store, authority } = fixture();
    const created = await store.create('code', 'verifier');
    expect((await store.resolve(created.token)).user.id).toBe('subject');
    await store.resolve(created.token);
    expect(authority.sessions.check).toHaveBeenCalledTimes(2);
    authority.sessions.check.mockRejectedValueOnce(new Error('Cr unavailable'));
    await expect(store.resolve(created.token)).rejects.toThrow('Cr unavailable');
    expect(authority.sessions.check).toHaveBeenCalledTimes(3);
  });
  it.each(['exchange', 'bind'] as const)('does not retry a failed %s or create a local session', async step => {
    const { store, authority } = fixture();
    const fail = step === 'exchange' ? authority.exchange : authority.sessions.bind;
    fail.mockRejectedValueOnce(new Error('unknown outcome'));
    await expect(store.create('code', 'verifier')).rejects.toThrow('unknown outcome');
    expect(fail).toHaveBeenCalledTimes(1);
    await expect(store.resolve(Buffer.alloc(32, 1).toString('base64url'))).rejects.toThrow();
  });
  it('rejects unknown/native/global-looking credentials without a Cr lookup', async () => {
    const { store, authority } = fixture();
    for (const token of ['v4.public.payload', 'eyJ.jwt.token', 'refresh-token', 'x'.repeat(43)]) await expect(store.resolve(token)).rejects.toThrow();
    expect(authority.sessions.check).not.toHaveBeenCalled();
  });
  it('rotates a browser session only after the new grant is bound', async () => {
    const { store, authority } = fixture();
    const first = await store.create('first', 'verifier');
    const next = await store.create('next', 'verifier', first.token);
    expect(next.token).not.toBe(first.token);
    await expect(store.resolve(first.token)).rejects.toThrow();
    await expect(store.resolve(next.token)).resolves.toHaveProperty('projectKey', 'glab');
    expect(authority.sessions.revoke).toHaveBeenCalledTimes(1);
  });
  it('keeps the old session if creating its replacement fails before rotation', async () => {
    const { store, authority } = fixture();
    const first = await store.create('first', 'verifier');
    authority.sessions.bind.mockRejectedValueOnce(new Error('bind unavailable'));
    await expect(store.create('next', 'verifier', first.token)).rejects.toThrow();
    await expect(store.resolve(first.token)).resolves.toHaveProperty('projectKey', 'glab');
    expect(authority.sessions.revoke).not.toHaveBeenCalled();
  });
  it('keeps neither local session after an unknown rotation revocation result', async () => {
    const { store, authority } = fixture();
    const first = await store.create('first', 'verifier');
    authority.sessions.revoke.mockRejectedValueOnce(new Error('Cr unreachable'));
    await expect(store.create('next', 'verifier', first.token)).rejects.toThrow('revocation');
    await expect(store.resolve(first.token)).rejects.toThrow();
    await expect(store.resolve(Buffer.alloc(32, 2).toString('base64url'))).rejects.toThrow();
  });
  it('never extends the original grant lifetime', async () => {
    const { store, authority } = fixture();
    const created = await store.create('code', 'verifier');
    authority.sessions.check.mockImplementationOnce(async value => ({ ...value, expiresAt: new Date(Date.parse(created.expiresAt) + 1000).toISOString() }));
    await expect(store.resolve(created.token)).rejects.toThrow();
    await expect(store.resolve(created.token)).rejects.toThrow();
    expect(authority.sessions.check).toHaveBeenCalledTimes(1);
  });
  it('retains a shortened expiry and rejects locally once it elapses', async () => {
    const { store, authority, advance } = fixture();
    const created = await store.create('code', 'verifier');
    authority.sessions.check.mockImplementationOnce(async value => ({ ...value, expiresAt: new Date(Date.parse(value.expiresAt) - 800_000).toISOString() }));
    await store.resolve(created.token);
    advance(100_001);
    await expect(store.resolve(created.token)).rejects.toThrow();
    expect(authority.sessions.check).toHaveBeenCalledTimes(1);
  });
  it('rejects identity/project changes from the authority', async () => {
    const { store, authority, grant } = fixture();
    const created = await store.create('code', 'verifier');
    authority.sessions.check.mockResolvedValueOnce({ ...grant, user: { ...grant.user, id: 'someone-else' } });
    await expect(store.resolve(created.token)).rejects.toThrow();
  });
  it('keeps local logout final when Cr revoke fails', async () => {
    const { store, authority } = fixture();
    const created = await store.create('code', 'verifier');
    authority.sessions.revoke.mockRejectedValueOnce(new Error('Cr unavailable'));
    await expect(store.revoke(created.token)).rejects.toThrow('Cr unavailable');
    await expect(store.resolve(created.token)).rejects.toThrow();
  });
  it('does not resurrect a session when a pending live check completes after logout', async () => {
    const { store, authority, grant } = fixture();
    const created = await store.create('code', 'verifier');
    let complete!: (grant: BoundServiceSession) => void;
    authority.sessions.check.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
    const pending = store.resolve(created.token);
    await store.revoke(created.token);
    complete(grant);
    await expect(pending).rejects.toThrow();
  });
  it('rechecks local logout immediately before execution after resource authorization', async () => {
    const { store } = fixture();
    const created = await store.create('code', 'verifier');
    const execute = vi.fn();
    await expect(store.run(created.token, { action: 'records.read', resource: 'record:1', body: '' }, {
      risk: 'sensitive_read', authorizeResource: async () => { await store.revoke(created.token); return true; }, execute,
    })).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
  it('never executes when the current resource policy denies', async () => {
    const { store } = fixture();
    const created = await store.create('code', 'verifier');
    const execute = vi.fn();
    await expect(store.run(created.token, { action: 'records.read', resource: 'record:1', body: '' }, {
      risk: 'sensitive_read', authorizeResource: () => false, execute,
    })).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
  it('bounds capacity and releases expired entries without a timer', async () => {
    const { store, advance, authority, grant } = fixture(1);
    await store.create('code', 'verifier');
    await expect(store.create('other', 'verifier')).rejects.toThrow('capacity');
    expect(authority.exchange).toHaveBeenCalledTimes(1);
    advance(900_001);
    authority.sessions.bind.mockResolvedValueOnce({ ...grant, expiresAt: new Date(Date.parse(grant.expiresAt) + 900_001).toISOString() });
    await expect(store.create('new', 'verifier')).resolves.toHaveProperty('token');
  });
  it('shutdown clears credentials and stops further creation/checks', async () => {
    const { store, authority } = fixture();
    const created = await store.create('code', 'verifier');
    store.close();
    await expect(store.resolve(created.token)).rejects.toThrow('closed');
    await expect(store.create('new', 'verifier')).rejects.toThrow('closed');
    expect(authority.exchange).toHaveBeenCalledTimes(1);
  });
});
