import { describe, expect, it, vi } from 'vitest';
import { CernereDelegationTokenProvider, DisabledUserDelegation, makeTokenProvider } from './tokens.ts';
import type { ServiceUserSession } from '../auth.ts';
import type { DelegatedHttpOperation } from '../../lib/cernere/packages/composite/src/delegation.js';
import { DelegationAudiences } from './delegation-audiences.ts';
const target = { service: 'aedilis', projectKey: 'aedilis', baseUrl: 'https://aedilis.example' };
const audiences = () => new DelegationAudiences(JSON.stringify({ aedilis: target.baseUrl }));
const session: ServiceUserSession = { token: 's'.repeat(43), grant: { projectToken: 'source-only', sessionBinding: 'b'.repeat(43), projectKey: 'glab',
  user: { id: 'subject', displayName: 'User', email: null, role: 'member' }, expiresAt: new Date(Date.now() + 600_000).toISOString() } };
const credential = () => ({ delegationToken: 't'.repeat(43), requestId: '22222222-2222-4222-8222-222222222222', expiresAt: new Date(Date.now() + 25_000).toISOString() });
function fixture() {
  const delegate = vi.fn(async (_token: string, _target: { projectKey: string; audience: string }, _operation: DelegatedHttpOperation) => credential());
  return { delegate, provider: new CernereDelegationTokenProvider({ delegate }, audiences()) };
}
describe('downstream operation capabilities', () => {
  it('issues upload arrival authority over the exact captured Blob and cancels transfer on disposal', async () => {
    const delegate = vi.fn(), delegateUpload = vi.fn(async () => ({ arrivalToken: 'u'.repeat(43), requestId: credential().requestId, expiresAt: credential().expiresAt }));
    const provider = new CernereDelegationTokenProvider({ delegate, delegateUpload }, audiences());
    const body = new Blob([new Uint8Array([255, 0, 13, 10])]);
    const upload = { body, maximumBytes: 200 * 1024 * 1024, timeoutSeconds: 300 };
    const result = await provider.authorize(session, { ...target, baseUrl: 'http://localhost:12345' }, { path: '/api/media', action: 'media.write', upload,
      init: { method: 'PUT', body, headers: { 'content-type': 'video/mp4', cookie: 'private=secret' } } });
    expect(result).not.toBeNull(); expect(delegate).not.toHaveBeenCalled();
    expect(delegateUpload).toHaveBeenCalledWith(session.token, { projectKey: target.projectKey, audience: target.baseUrl },
      expect.objectContaining({ body, method: 'PUT', path: '/api/media' }), expect.any(AbortSignal));
    expect(new Uint8Array(await new Response(result!.init.body as ReadableStream<Uint8Array>).arrayBuffer()))
      .toEqual(new Uint8Array(await body.arrayBuffer()));
    expect(new Headers(result!.init.headers).get('content-length')).toBe(String(body.size));
    expect(new Headers(result!.init.headers).get('authorization')).toBe(`Cernere-Upload ${'u'.repeat(43)}`);
    expect(new Headers(result!.init.headers).has('cookie')).toBe(false);
    expect(result!.init.signal!.aborted).toBe(false); await result!.dispose!(); expect(result!.init.signal!.aborted).toBe(true);
  });
  it('never substitutes another body or the ordinary delegate when upload support is absent', async () => {
    const { provider, delegate } = fixture(); const body = new Blob(['fixed']);
    const upload = { body, maximumBytes: 10, timeoutSeconds: 5 };
    expect(await provider.authorize(session, target, { path: '/api/media', action: 'media.write', upload, init: { method: 'PUT', body: new Blob(['fixed']) } })).toBeNull();
    expect(await provider.authorize(session, target, { path: '/api/media', action: 'media.write', upload, init: { method: 'PUT', body } })).toBeNull();
    expect(delegate).not.toHaveBeenCalled();
  });
  it('keeps the prepared connector path after an asynchronous caller mutation', async () => {
    const operation = { path: '/records', action: 'records.read' };
    const { provider, delegate } = fixture();
    delegate.mockImplementationOnce(async () => { operation.path = '/other-records'; return credential(); });
    const result = await provider.authorize(session, target, operation);
    expect(result!.path).toBe('/records'); expect(delegate.mock.calls[0]![2].path).toBe('/records');
  });
  it('uses only the administrator audience with a different transport origin and ignores an advertised audience', async () => {
    const { provider, delegate } = fixture();
    const advertised = { ...target, baseUrl: 'http://localhost:12345/internal', audience: 'https://attacker.example' };
    const result = await provider.authorize(session, advertised, { path: '/records', action: 'records.read' });
    expect(result).not.toBeNull();
    expect(delegate.mock.calls[0]![1]).toEqual({ projectKey: 'aedilis', audience: target.baseUrl });
    expect(delegate.mock.calls[0]![2].path).toBe('/internal/records');
  });
  it('snapshots actor, project and action before asynchronous request serialization', async () => {
    const { provider, delegate } = fixture(), actor = { ...session }, destination = { ...target }, operation = { path: '/records', action: 'records.read' };
    const pending = provider.authorize(actor, destination, operation);
    actor.token = 'changed'; destination.projectKey = 'other'; destination.baseUrl = 'https://other.example'; operation.action = 'records.delete';
    expect(await pending).not.toBeNull();
    expect(delegate.mock.calls[0]![0]).toBe(session.token);
    expect(delegate.mock.calls[0]![1]).toEqual({ projectKey: 'aedilis', audience: target.baseUrl });
    expect(delegate.mock.calls[0]![2].action).toBe('records.read');
  });
  it('refuses an unconfigured destination without authority calls or origin fallback', async () => {
    const delegate = vi.fn(), delegateUpload = vi.fn();
    const provider = new CernereDelegationTokenProvider({ delegate, delegateUpload }, new DelegationAudiences('{}'));
    expect(await provider.authorize(session, target, { path: '/records', action: 'records.read' })).toBeNull();
    const body = new Blob(['exact']);
    expect(await provider.authorize(session, target, { path: '/upload', action: 'media.write', upload: { body, maximumBytes: 10, timeoutSeconds: 5 }, init: { method: 'PUT', body } })).toBeNull();
    expect(delegate).not.toHaveBeenCalled(); expect(delegateUpload).not.toHaveBeenCalled();
  });
  it('forwards only a destination capability and the exact prepared request', async () => {
    const { provider, delegate } = fixture();
    const result = await provider.authorize(session, target, { path: '/api/bookings?room=1', action: 'booking.create', init: {
      method: 'POST', body: '{"room":1}', headers: { 'content-type': 'application/json', authorization: 'Bearer must-not-forward', cookie: 'private=secret' },
    } });
    expect(result).not.toBeNull();
    const [token, requestedTarget, operation] = delegate.mock.calls[0]!;
    expect(token).toBe(session.token);
    expect(requestedTarget).toEqual({ projectKey: 'aedilis', audience: target.baseUrl });
    expect(operation).toMatchObject({ method: 'POST', path: '/api/bookings?room=1', resource: '/api/bookings?room=1' });
    expect(new TextDecoder().decode(operation.body as Uint8Array)).toBe('{"room":1}');
    expect(operation.headers.has('authorization')).toBe(false);
    expect(operation.headers.has('cookie')).toBe(false);
    const headers = new Headers(result!.init.headers);
    expect(headers.get('authorization')).toBe(`Cernere-Delegation ${credential().delegationToken}`);
    expect(headers.get('x-cernere-request-id')).toBe(credential().requestId);
    expect(result!.init.body).toBe(operation.body);
    expect(result!.init.redirect).toBe('error');
    expect(result!.init.credentials).toBe('omit');
  });
  it('prepares multipart once and preserves its boundary with the hashed bytes', async () => {
    const { provider, delegate } = fixture();
    const form = new FormData(); form.set('name', 'record'); form.set('file', new Blob(['file bytes']), 'record.txt');
    const result = await provider.authorize(session, target, { path: '/api/files', action: 'files.create', init: { method: 'POST', body: form } });
    const operation = delegate.mock.calls[0]![2];
    const contentType = operation.headers.get('content-type')!;
    expect(contentType).toContain('multipart/form-data; boundary=');
    const boundary = contentType.split('boundary=')[1]!;
    expect(new TextDecoder().decode(operation.body as Uint8Array)).toContain(`--${boundary}`);
    expect(new Headers(result!.init.headers).get('content-type')).toBe(contentType);
    expect(result!.init.body).toBe(operation.body);
  });
  it('binds the configured base path while returning the connector-relative path', async () => {
    const { provider, delegate } = fixture();
    const result = await provider.authorize(session, { ...target, baseUrl: target.baseUrl + '/base/' }, { path: '/records', action: 'records.read' });
    expect(result!.path).toBe('/records');
    expect(delegate.mock.calls[0]![2].path).toBe('/base/records');
    expect(delegate.mock.calls[0]![1].audience).toBe(target.baseUrl);
  });
  it('keeps sensitive GET bodies empty and sets explicit transport defaults', async () => {
    const { provider, delegate } = fixture();
    const result = await provider.authorize(session, target, { path: '/records', action: 'records.read' });
    const operation = delegate.mock.calls[0]![2];
    expect((operation.body as Uint8Array).byteLength).toBe(0);
    expect(operation.headers.get('accept')).toBe('*/*');
    expect(operation.headers.get('accept-language')).toBe('*');
    expect(result!.init.body).toBeUndefined();
  });
  it('does not issue on missing session, project, classification or unsafe URL/path', async () => {
    const { provider, delegate } = fixture();
    expect(await provider.authorize(null, target, { path: '/records', action: 'records.read' })).toBeNull();
    for (const baseUrl of ['http://remote.example', 'https://user:secret@aedilis.example', 'https://aedilis.example/?secret=1']) {
      expect(await provider.authorize(session, { ...target, baseUrl }, { path: '/records', action: 'records.read' })).toBeNull();
    }
    for (const path of ['//other.example/records', '/a/../records', '/records#fragment']) {
      expect(await provider.authorize(session, target, { path, action: 'records.read' })).toBeNull();
    }
    expect(await provider.authorize(session, target, { path: '/records', action: '' })).toBeNull();
    expect(delegate).not.toHaveBeenCalled();
  });
  it('never retries or returns an anonymous request after authority failure', async () => {
    const { provider, delegate } = fixture(); delegate.mockRejectedValueOnce(new Error('private credential failure'));
    expect(await provider.authorize(session, target, { path: '/records', action: 'records.read' })).toBeNull();
    expect(delegate).toHaveBeenCalledTimes(1);
  });
  it('requires the new explicit mode and rejects old token/passthrough modes', () => {
    const { delegate } = fixture();
    expect(makeTokenProvider('cernere-service-delegation', { delegate }, { delegationAudiences: '{}' }).mode).toBe('cernere-service-delegation');
    expect(() => makeTokenProvider('cernere-service-delegation', { delegate })).toThrow(/CORPUS_DELEGATION_AUDIENCES/);
    for (const mode of [undefined, 'passthrough', 'cernere-project-token', 'none', 'unknown']) expect(() => makeTokenProvider(mode, { delegate })).toThrow();
    expect(makeTokenProvider(undefined, null, { noAuth: true })).toBeInstanceOf(DisabledUserDelegation);
    expect(() => makeTokenProvider('unknown', null, { noAuth: true })).toThrow();
  });
});
