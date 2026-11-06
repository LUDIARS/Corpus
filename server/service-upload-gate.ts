/** Source/target capture is opt-in; final authority and current local ACL stay mandatory.
 * @implements SPEC-HUB-BOUND-SERVICE-SESSION
 */
import type { Context, Next } from 'hono';
import { CompositeAuthorityError } from '../lib/cernere/packages/composite/src/service-session.js';
import { requireUploadLimits } from '../lib/cernere/packages/composite/src/upload-body.js';
import type { AuthIdentity } from './auth.ts';
import { ServiceSessionMissingError } from './service-session-store.ts';
import type { ClassifiedServiceOperation, ServiceOperationCredential, ServiceOperationGate } from './service-operation-gate.ts';
import { operationCapturePool, CaptureUnavailableError, type OwnedBodyCapture, type CaptureLimits } from './upload-capture.ts';
import { OperationBodyError } from './service-operation-body.ts';

export interface AuthorizedUploadBody { body: Blob; maximumBytes: number; timeoutSeconds: number }
/** Backend-only exact captured body; it never contains user/global credentials. */
export function getAuthorizedUploadBody(c: Context): AuthorizedUploadBody | null { return c.get('authorizedUploadBody') ?? null; }

export async function runServiceUpload(c: Context, next: Next, gate: ServiceOperationGate,
  credential: ServiceOperationCredential, classified: ClassifiedServiceOperation): Promise<Response | void> {
  if (!classified.upload || classified.risk !== 'important' || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)
    || 'delegation' in credential) return c.json({ error: 'upload_operation_unclassified' }, 403);
  let executing = false, denied = false, capture: OwnedBodyCapture | undefined, replay: Request | undefined;
  const original = c.req.raw;
  try {
    const limits = requireUploadLimits({ ...classified.upload, maximumBytes: Math.min(classified.maximumBodyBytes, classified.upload.maximumBytes) });
    if (original.bodyUsed || Object.keys(c.req.bodyCache).length) throw new OperationBodyError(400);
    const url = new URL(c.req.url), resource = url.pathname + url.search;
    const current = (): boolean => gate.isCurrent() && !original.signal.aborted;
    const dispose = async (): Promise<void> => {
      try { if (replay?.body && !replay.body.locked) await replay.body.cancel().catch(() => {}); }
      finally { if (capture) await capture.dispose(); }
    };
    const receive = async (captureLimits: CaptureLimits): Promise<OwnedBodyCapture> => {
      capture = await operationCapturePool.capture(original, captureLimits);
      replay = new Request(original, { body: capture.body, duplex: 'half' } as RequestInit); c.req.raw = replay;
      c.set('authorizedUploadBody', { body: capture.body, ...limits });
      return { body: capture.body, dispose };
    };
    const authorize = async (identity: AuthIdentity): Promise<boolean> => {
      c.set('auth', identity);
      const latest = gate.policy(c);
      const valid = current() && latest?.action === classified.action && latest.risk === 'important' && latest.upload
        && latest.maximumBodyBytes >= (capture?.body.size ?? Infinity) && latest.upload.maximumBytes >= (capture?.body.size ?? Infinity)
        && latest.upload.timeoutSeconds >= limits.timeoutSeconds;
      const allowed = !!valid && await latest!.authorizeResource(c, identity);
      denied = !allowed; return allowed && current();
    };
    const execute = async (): Promise<void> => { if (!current()) throw new Error('Upload owner ended'); executing = true; await next(); };
    if ('session' in credential) {
      if (!gate.sessions.runCaptured) throw new Error('Captured session authority is unavailable');
      const owned = await receive(limits);
      await gate.sessions.runCaptured(credential.session.token, { action: classified.action, resource, body: owned.body }, {
        risk: 'important', maximumBytes: limits.maximumBytes, signal: original.signal, isCurrent: current,
        authorizeResource: () => authorize(credential.identity), execute,
      });
    } else {
      if (!gate.uploads) throw new Error('Upload authority is unavailable');
      await gate.uploads.run(credential.upload, { action: classified.action, resource, path: resource,
        method: c.req.method as 'POST' | 'PUT' | 'PATCH' | 'DELETE', headers: original.headers,
        additionalHeaders: classified.additionalHeaders, requestId: credential.requestId }, {
        risk: 'important', limits, signal: original.signal, isCurrent: current, capture: receive,
        authorizeResource: decision => authorize(gate.identity(decision)), execute,
      });
    }
  } catch (error) {
    if (executing) throw error;
    if (error instanceof OperationBodyError) return c.json({ error: 'invalid_operation_body' }, error.status);
    if (error instanceof CaptureUnavailableError) return c.json({ error: 'operation_capture_unavailable' }, 503);
    if (denied) return c.json({ error: 'resource_access_denied' }, 403);
    const rejected = error instanceof ServiceSessionMissingError || error instanceof CompositeAuthorityError && [401, 403].includes(error.status);
    return c.json({ error: rejected ? 'operation_denied' : 'operation_authority_unavailable' }, rejected ? 403 : 503);
  } finally {
    c.set('authorizedUploadBody', undefined);
    try { if (replay?.body && !replay.body.locked) await replay.body.cancel().catch(() => {}); }
    finally { if (capture) await capture.dispose(); }
  }
}
