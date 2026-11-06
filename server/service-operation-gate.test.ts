import { describe, expect, it, vi } from 'vitest';
import { Hono, type Context } from 'hono';
import { createHash } from 'node:crypto';
import { CompositeAuthorityError } from '../lib/cernere/packages/composite/src/service-session.js';
import type { AuthIdentity, ServiceUserSession } from './auth.ts';
import { getIdentity, getUserSession } from './auth.ts';
import { runServiceOperation, type ServiceOperationGate } from './service-operation-gate.ts';

const identity: AuthIdentity = { userId: 'member', externalId: 'mapped', role: 'general', displayName: 'Member', projectKey: 'target', isAdmin: false };
const session: ServiceUserSession = { token: 's'.repeat(43), grant: { projectKey: 'target', projectToken: 'private-grant',
  sessionBinding: 'b'.repeat(43), expiresAt: new Date(Date.now() + 600_000).toISOString(),
  user: { id: 'member', role: 'general', displayName: 'Member', email: null } } };
const requestId = '33a39d27-96e9-40a3-bdba-52f1e8a81ae7';
const decision = { projectKey: 'target', sourceProject: 'source', user: session.grant.user,
  expiresAt: new Date(Date.now() + 20_000).toISOString(), requestId, risk: 'sensitive_read' as const };

function fixture() {
  let current = true;
  const resource = vi.fn((_context: Context, _identity: AuthIdentity) => true);
  const gate: ServiceOperationGate = {
    policy: () => ({ action: 'member.record.read', risk: 'sensitive_read', maximumBodyBytes: 4096, authorizeResource: resource }),
    sessions: { run: vi.fn(async (_token, _operation, operation) => {
      if (!await operation.authorizeResource({ requestId, risk: operation.risk })) throw new Error('Denied');
      return operation.execute();
    }) },
    delegations: { run: vi.fn(async (_token, _operation, operation) => {
      if (!await operation.authorizeResource(decision)) throw new Error('Denied');
      return operation.execute(decision);
    }) },
    identity: () => identity, isCurrent: () => current,
  };
  const executed = vi.fn();
  const app = new Hono();
  app.use('*', async (c, next) => runServiceOperation(c, next, gate,
    c.req.header('authorization')?.startsWith('Cernere-Delegation ')
      ? { delegation: 'd'.repeat(43), requestId }
      : c.req.header('authorization')?.startsWith('Cernere-Upload ')
        ? { upload: 'u'.repeat(43), requestId } : { session, identity }));
  app.all('*', async c => {
    executed();
    return c.json({ userId: getIdentity(c).userId, session: getUserSession(c), body: await c.req.text() });
  });
  return { gate, app, resource, executed, stop: () => { current = false; } };
}

describe('shared bound operation gate (contract only; no external authority)', () => {
  it('denies an unclassified GET before authority or data execution', async () => {
    const f = fixture(); f.gate.policy = () => null;
    const response = await f.app.request('/api/private');
    expect(response.status).toBe(403);
    expect(f.gate.sessions.run).not.toHaveBeenCalled(); expect(f.executed).not.toHaveBeenCalled();
  });
  it('classifies sensitive GET and rechecks current data access after Cr consumption', async () => {
    const f = fixture(); f.resource.mockReturnValue(false);
    expect((await f.app.request('/api/private')).status).toBe(403);
    expect(f.gate.sessions.run).toHaveBeenCalledWith(session.token,
      { action: 'member.record.read', resource: '/api/private', body: new Uint8Array() }, expect.objectContaining({ risk: 'sensitive_read' }));
    expect(f.resource).toHaveBeenCalled(); expect(f.executed).not.toHaveBeenCalled();
  });
  it('binds the actual binary body and preserves the exact route input', async () => {
    const f = fixture(); const bytes = new TextEncoder().encode('{ "note" : "日本語" }\r\n');
    const response = await f.app.request('/api/record?q=1', { method: 'POST', body: bytes, headers: { 'content-type': 'application/json' } });
    expect(response.status).toBe(200);
    expect((await response.json() as { body: string }).body).toBe(new TextDecoder().decode(bytes));
    expect(f.gate.sessions.run).toHaveBeenCalledWith(session.token,
      expect.objectContaining({ resource: '/api/record?q=1', body: bytes }), expect.any(Object));
  });
  it('binds the complete private callback query without disclosing it to authority or changing route input', async () => {
    const f = fixture();
    f.gate.policy = () => ({ action: 'account.callback.complete', risk: 'important', maximumBodyBytes: 0,
      privateQuery: true, authorizeResource: f.resource });
    const queries = ['?state=one&code=first', '?state=one&code=second', '?code=first&state=one',
      '?state=one&code=first&code=second', '?state=one&code=%66irst', ''];
    const resources: string[] = [];
    const observed: string[] = [];
    f.resource.mockImplementation(c => { observed.push(new URL(c.req.url).search); return true; });
    for (const search of queries) {
      expect((await f.app.request('/callback' + search)).status).toBe(200);
      const operation = vi.mocked(f.gate.sessions.run).mock.calls.at(-1)![1];
      expect(operation).toEqual({ action: 'account.callback.complete', body: new Uint8Array(),
        resource: '/callback#query-sha256=' + createHash('sha256').update(search, 'utf8').digest('hex') });
      resources.push(operation.resource);
      expect(JSON.stringify(operation)).not.toContain('state=');
      expect(JSON.stringify(operation)).not.toContain('code=');
    }
    expect(new Set(resources).size).toBe(queries.length);
    expect(observed).toEqual(queries);
    expect(f.gate.delegations.run).not.toHaveBeenCalled();
  });
  it('rejects private-query policy on delegation, uploads, non-important GET or nonempty-body classifications', async () => {
    const variants = [
      { method: 'GET', risk: 'important', maximumBodyBytes: 0, delegation: true },
      { method: 'GET', risk: 'important', maximumBodyBytes: 0, uploadCredential: true },
      { method: 'POST', risk: 'important', maximumBodyBytes: 0 },
      { method: 'GET', risk: 'sensitive_read', maximumBodyBytes: 0 },
      { method: 'GET', risk: 'important', maximumBodyBytes: 1 },
      { method: 'GET', risk: 'important', maximumBodyBytes: 0, upload: { maximumBytes: 10, timeoutSeconds: 10 } },
      { method: 'GET', risk: 'important', maximumBodyBytes: 0, invalidFlag: true },
    ] as const;
    for (const variant of variants) {
      const f = fixture();
      f.gate.policy = () => ({ action: 'account.callback.complete', risk: variant.risk,
        maximumBodyBytes: variant.maximumBodyBytes, privateQuery: ('invalidFlag' in variant ? false : true) as true,
        ...('upload' in variant ? { upload: variant.upload } : {}), authorizeResource: f.resource });
      const response = await f.app.request('/callback?state=one&code=first', { method: variant.method,
        ...('delegation' in variant ? { headers: { authorization: 'Cernere-Delegation opaque' } }
          : 'uploadCredential' in variant ? { headers: { authorization: 'Cernere-Upload opaque' } } : {}) });
      expect(response.status).toBe(403);
      expect(f.gate.sessions.run).not.toHaveBeenCalled(); expect(f.gate.delegations.run).not.toHaveBeenCalled();
      expect(f.resource).not.toHaveBeenCalled(); expect(f.executed).not.toHaveBeenCalled();
    }
  });
  it('rejects an oversized chunked body before contacting authority', async () => {
    const f = fixture();
    expect((await f.app.request('/api/private', { method: 'POST', body: new Uint8Array(4097) })).status).toBe(413);
    expect(f.gate.sessions.run).not.toHaveBeenCalled(); expect(f.executed).not.toHaveBeenCalled();
  });
  it('uses the explicit delegation path with actual headers and no reusable session', async () => {
    const f = fixture(); const response = await f.app.request('/api/private?record=7', { headers: { authorization: `Cernere-Delegation ${'d'.repeat(43)}`, range: 'bytes=0-9' } });
    expect(response.status).toBe(200);
    expect((await response.json() as { session: unknown }).session).toBeNull();
    expect(f.gate.sessions.run).not.toHaveBeenCalled();
    expect(f.gate.delegations.run).toHaveBeenCalledWith('d'.repeat(43), expect.objectContaining({ method: 'GET', path: '/api/private?record=7', requestId }), expect.any(Object));
    expect(f.resource).toHaveBeenCalledWith(expect.any(Object), identity);
  });
  it('does not fall back to local sessions when the delegation is denied or authority is unavailable', async () => {
    for (const status of [403, 503]) {
      const f = fixture(); vi.mocked(f.gate.delegations.run).mockRejectedValueOnce(new CompositeAuthorityError(status));
      const response = await f.app.request('/api/private', { headers: { authorization: `Cernere-Delegation ${'d'.repeat(43)}`, cookie: `__Host-corpus_session=${session.token}` } });
      expect(response.status).toBe(status); expect(f.gate.sessions.run).not.toHaveBeenCalled(); expect(f.executed).not.toHaveBeenCalled();
    }
  });
  it('does not execute after the gate owner has ended', async () => {
    const f = fixture(); f.stop();
    expect((await f.app.request('/api/private')).status).toBe(503);
    expect(f.executed).not.toHaveBeenCalled();
  });
});
