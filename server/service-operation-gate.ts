/** Host-classified operations enter the shared live Cr gate before route execution.
 * Domain data authorization belongs to the host callback and endpoint transaction.
 * @implements SPEC-HUB-BOUND-SERVICE-SESSION
 */
import type { Context, Next } from 'hono';
import type { CompositeDelegations, DelegationDecision, DelegatedHttpOperation } from '../lib/cernere/packages/composite/src/delegation.js';
import { CompositeAuthorityError, isServiceOperationRisk, type ServiceOperationRisk } from '../lib/cernere/packages/composite/src/service-session.js';
import type { AuthIdentity, ServiceUserSession } from './auth.ts';
import type { ServiceSessionStore } from './service-session-store.ts';
import { ServiceSessionMissingError } from './service-session-store.ts';
import { OperationBodyError, readOperationBody } from './service-operation-body.ts';
import type { CompositeUploads } from '../lib/cernere/packages/composite/src/upload.js';
import type { UploadLimits } from '../lib/cernere/packages/composite/src/upload-body.js';
import { runServiceUpload } from './service-upload-gate.ts';

export interface ClassifiedServiceOperation {
  action: string;
  risk: ServiceOperationRisk;
  /** Explicit per-route upload limit; never trust Content-Length alone. */
  maximumBodyBytes: number;
  additionalHeaders?: readonly string[];
  /** Explicitly opt into bounded private capture; ordinary routes stay small. */
  upload?: UploadLimits;
  /** Read current domain/resource permissions, not just the Cr role/active flag.
   * Row-level mutation checks still belong in the endpoint's database transaction.
   */
  authorizeResource: (context: Context, identity: AuthIdentity) => boolean | Promise<boolean>;
}
/** Server-owned classification. No default based only on HTTP method is permitted. */
export type ServiceOperationPolicy = (context: Context) => ClassifiedServiceOperation | null;
export interface ServiceOperationGate {
  policy: ServiceOperationPolicy;
  sessions: Pick<ServiceSessionStore, 'run'> & Partial<Pick<ServiceSessionStore, 'runCaptured'>>;
  delegations: Pick<CompositeDelegations, 'run'>;
  uploads?: Pick<CompositeUploads, 'run'>;
  identity: (decision: DelegationDecision) => AuthIdentity;
  isCurrent: () => boolean;
}
export type ServiceOperationCredential = { session: ServiceUserSession; identity: AuthIdentity }
  | { delegation: string; requestId: string } | { upload: string; requestId: string };

export async function runServiceOperation(
  c: Context, next: Next, gate: ServiceOperationGate,
  credential: ServiceOperationCredential,
): Promise<Response | void> {
  const classified = gate.policy(c);
  if (!classified || !classified.action || !isServiceOperationRisk(classified.risk) || typeof classified.authorizeResource !== 'function') {
    return c.json({ error: 'operation_unclassified' }, 403);
  }
  if (classified.upload || 'upload' in credential) return runServiceUpload(c, next, gate, credential, classified);
  let executing = false;
  let resourceDenied = false;
  try {
    const body = await readOperationBody(c, classified.maximumBodyBytes);
    const url = new URL(c.req.url);
    const resource = url.pathname + url.search;
    const authorize = async (identity: AuthIdentity): Promise<boolean> => {
      if (!gate.isCurrent()) throw new Error('Authentication owner ended');
      c.set('auth', identity);
      const allowed = await classified.authorizeResource(c, identity);
      resourceDenied = allowed !== true;
      return allowed === true && gate.isCurrent();
    };
    const execute = async (): Promise<void> => {
      if (!gate.isCurrent() || c.req.raw.signal.aborted) throw new Error('Operation owner ended');
      executing = true;
      await next();
    };
    if ('session' in credential) {
      await gate.sessions.run(credential.session.token, { action: classified.action, resource, body }, {
        risk: classified.risk, authorizeResource: () => authorize(credential.identity), execute,
      });
      return;
    }
    if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)) return c.json({ error: 'invalid_delegation_method' }, 403);
    await gate.delegations.run(credential.delegation, {
      action: classified.action, resource, path: resource, method: c.req.method as DelegatedHttpOperation['method'], body,
      headers: c.req.raw.headers, additionalHeaders: classified.additionalHeaders, requestId: credential.requestId,
    }, { risk: classified.risk, authorizeResource: decision => authorize(gate.identity(decision)), execute });
  } catch (error) {
    // Once the endpoint starts, its failures/unknown results are endpoint-owned;
    // do not disguise a database failure as a safely retryable authentication error.
    if (executing) throw error;
    if (error instanceof OperationBodyError) return c.json({ error: 'invalid_operation_body' }, error.status);
    if (resourceDenied) return c.json({ error: 'resource_access_denied' }, 403);
    const denied = error instanceof ServiceSessionMissingError || (error instanceof CompositeAuthorityError && [401, 403].includes(error.status));
    return c.json({ error: denied ? 'operation_denied' : 'operation_authority_unavailable' }, denied ? 403 : 503);
  }
}
