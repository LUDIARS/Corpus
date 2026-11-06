/** @implements SPEC-HUB-BOUND-SERVICE-SESSION */
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { CompositeUploads } from '../lib/cernere/packages/composite/src/upload.js';
import { CompositeServiceSessions, type AuthorityCall } from '../lib/cernere/packages/composite/src/service-session.js';
import { runServiceOperation, type ServiceOperationGate } from './service-operation-gate.ts';
import { getAuthorizedUploadBody } from './service-upload-gate.ts';
import type { AuthIdentity, ServiceUserSession } from './auth.ts';

const identity: AuthIdentity = { userId: 'member', externalId: 'mapped', role: 'general', displayName: 'Member', projectKey: 'target', isAdmin: false };
const session: ServiceUserSession = { token: 's'.repeat(43), grant: { projectKey: 'target', projectToken: 'private-grant', sessionBinding: 'b'.repeat(43),
  expiresAt: new Date(Date.now() + 600_000).toISOString(), user: { id: 'member', role: 'general', displayName: 'Member', email: null } } };
const requestId = '33a39d27-96e9-40a3-bdba-52f1e8a81ae7', bytes = new Uint8Array([0, 255, 13, 10]);
const limits = { maximumBytes: 100, timeoutSeconds: 30 };
function fixture() {
  let current = true, allowed = true, wrongDigest = false, consumed = false, expiresAt = '';
  const events: string[] = [];
  const call = vi.fn<AuthorityCall>(async (action, raw) => {
    const body = raw as Record<string, unknown>; events.push(action);
    if (action === 'authorize') return { permit: 'p'.repeat(43), expiresIn: 30, risk: 'important' };
    if (action === 'consume') { consumed = true; return { allowed: true, requestId: body.requestId, risk: 'important' }; }
    if (action === 'begin-upload') {
      expiresAt = new Date(Date.now() + 20_000).toISOString();
      return { receipt: 'r'.repeat(43), requestId, risk: 'important', limits, expiresAt, byteLength: bytes.length,
        contentDigest: createHash('sha256').update(wrongDigest ? 'other' : bytes).digest('base64url') };
    }
    if (action === 'finalize-upload') { consumed = true; return { allowed: true, requestId, risk: 'important', expiresAt,
      projectKey: 'target', sourceProject: 'source', user: session.grant.user }; }
    if (action === 'cancel-upload') return { cancelled: true };
    throw new Error('Unexpected authority operation');
  });
  const sessions = new CompositeServiceSessions(call);
  const resource = vi.fn(() => { events.push('acl'); expect(consumed).toBe(true); return allowed; });
  const gate: ServiceOperationGate = {
    sessions: { run: async () => { throw new Error('Small-body gate must not run'); },
      runCaptured: (token, operation, options) => { expect(token).toBe(session.token); return sessions.runCaptured(session.grant, operation, options); } },
    delegations: { run: async () => { throw new Error('Ordinary delegation must not run'); } }, uploads: new CompositeUploads(call, 'target'),
    policy: () => ({ action: 'media.write', risk: 'important', maximumBodyBytes: 100, upload: limits, authorizeResource: resource }),
    identity: () => identity, isCurrent: () => current,
  };
  const app = new Hono(), executed = vi.fn();
  app.use('*', (c, next) => runServiceOperation(c, next, gate, c.req.header('authorization')
    ? { upload: 'u'.repeat(43), requestId } : { session, identity }));
  app.put('*', async c => {
    events.push('execute'); executed();
    const authorized = getAuthorizedUploadBody(c)!, replay = new Uint8Array(await c.req.arrayBuffer());
    expect(replay).toEqual(new Uint8Array(await authorized.body.arrayBuffer()));
    return c.json({ bytes: Array.from(replay) });
  });
  return { app, call, gate, events, executed, stop: () => { current = false; }, deny: () => { allowed = false; }, corrupt: () => { wrongDigest = true; } };
}
const incoming = { method: 'PUT', body: bytes, headers: { authorization: `Cernere-Upload ${'u'.repeat(43)}` } };
describe('bounded operation gate using the real shared SDK', () => {
  it('binds captured local bytes before current ACL and execution', async () => {
    const f = fixture(); const result = await f.app.request('/media', { method: 'PUT', body: bytes });
    expect(result.status).toBe(200); expect(await result.json()).toEqual({ bytes: Array.from(bytes) });
    expect(f.events).toEqual(['authorize', 'consume', 'acl', 'execute']);
    expect(f.call.mock.calls[0]![1]).toMatchObject({ contentDigest: createHash('sha256').update(bytes).digest('base64url'), resource: '/media' });
  });
  it('reserves then finalizes incoming bytes before current target ACL', async () => {
    const f = fixture(); expect((await f.app.request('/media', incoming)).status).toBe(200);
    expect(f.events).toEqual(['begin-upload', 'finalize-upload', 'acl', 'execute']);
  });
  it('cancels a substituted body without finalization or execution', async () => {
    const f = fixture(); f.corrupt(); expect((await f.app.request('/media', incoming)).status).toBe(503);
    expect(f.events).toEqual(['begin-upload', 'cancel-upload']); expect(f.executed).not.toHaveBeenCalled();
  });
  it('retains the target ACL after successful Cr consumption', async () => {
    const f = fixture(); f.deny(); expect((await f.app.request('/media', incoming)).status).toBe(403);
    expect(f.events).toEqual(['begin-upload', 'finalize-upload', 'acl']); expect(f.executed).not.toHaveBeenCalled();
  });
  it('rejects missing classification and ended owners', async () => {
    const f = fixture(); f.gate.policy = () => null;
    expect((await f.app.request('/media', incoming)).status).toBe(403); expect(f.call).not.toHaveBeenCalled();
    const ended = fixture(); ended.stop(); expect((await ended.app.request('/media', incoming)).status).toBe(503);
    expect(ended.executed).not.toHaveBeenCalled();
  });
});
