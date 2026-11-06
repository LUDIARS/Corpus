/** Corpus authenticates its own opaque sessions through the shared live Cr gate.
 * Resource authorization remains owned by each host/endpoint.
 * @implements SPEC-HUB-BOUND-SERVICE-SESSION
 */
import type { Context, MiddlewareHandler } from 'hono';
import { CompositeAuthorityError, type BoundServiceSession } from '../lib/cernere/packages/composite/src/service-session.js';
import { resolveExternalId, type CorpusDb } from './db.ts';
import { clearServiceSessionCookie, readServiceSessionCookie } from './service-session-cookie.ts';
import { ServiceSessionMissingError, type ServiceSessionStore } from './service-session-store.ts';
import { extractServiceTokenCandidate, matchExternalServiceRoute, type ExternalServiceAuth } from './external-service-auth.ts';
import { isServiceTokenCandidate, type ServicePrincipal } from './service-token.ts';
import type { CompositeDelegations, DelegationDecision } from '../lib/cernere/packages/composite/src/delegation.js';
import type { CompositeUploads } from '../lib/cernere/packages/composite/src/upload.js';
import { runServiceOperation, type ServiceOperationGate, type ServiceOperationPolicy } from './service-operation-gate.ts';

export interface AuthIdentity {
  /** Cr's stable service subject, including its existing federation resolution. */
  userId: string;
  externalId: string;
  role: string;
  displayName: string | null;
  projectKey: string | null;
  isAdmin: boolean;
}
export interface ServiceUserSession {
  /** Backend-only local credential; never forward this credential downstream. */
  token: string;
  grant: BoundServiceSession;
}
interface AuthOptions {
  sessions: Pick<ServiceSessionStore, 'resolve' | 'run'>;
  delegations: Pick<CompositeDelegations, 'run'>;
  uploads?: Pick<CompositeUploads, 'run'>;
  operationPolicy: ServiceOperationPolicy;
  adminIds: ReadonlySet<string>;
  db: CorpusDb;
  issuer: string;
  publicOrigin: string;
  externalService?: ExternalServiceAuth | null;
}
let optsRef: AuthOptions | null = null;
export function startAuth(opts: AuthOptions): () => void {
  if (new URL(opts.publicOrigin).origin !== opts.publicOrigin) throw new Error('Canonical service public origin is required');
  if (typeof opts.operationPolicy !== 'function') throw new Error('A host-owned service operation policy is required');
  if (optsRef) throw new Error('Corpus authentication is already started');
  const owner = { ...opts };
  optsRef = owner;
  return () => { if (optsRef === owner) optsRef = null; };
}
function extractBearerToken(c: Context): string | null {
  const value = c.req.header('authorization');
  return value?.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : null;
}
type UserAuthResult =
  | { ok: true; session: ServiceUserSession; identity: AuthIdentity }
  | { ok: false; status: 401 | 403 | 503; error: string };

function identityFromGrant(owner: AuthOptions, grant: Pick<BoundServiceSession, 'user' | 'projectKey'>): AuthIdentity {
  return {
    userId: grant.user.id, externalId: resolveExternalId(owner.db, owner.issuer, grant.user.id),
    role: grant.user.role, displayName: grant.user.displayName, projectKey: grant.projectKey,
    isAdmin: owner.adminIds.has(grant.user.id),
  };
}
function operationGate(owner: AuthOptions): ServiceOperationGate {
  return { policy: owner.operationPolicy, sessions: owner.sessions, delegations: owner.delegations, uploads: owner.uploads,
    identity: (decision: DelegationDecision) => identityFromGrant(owner, decision), isCurrent: () => optsRef === owner };
}

async function resolveUserAuth(c: Context, bearer: string | null): Promise<UserAuthResult> {
  const owner = optsRef;
  if (!owner) return { ok: false, status: 503, error: 'authentication_unavailable' };
  const secure = new URL(owner.publicOrigin).protocol === 'https:';
  const token = bearer ?? readServiceSessionCookie(c, secure);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return { ok: false, status: 401, error: 'service_session_required' };
  // Cookies are ambient authority; state-changing cookie requests require an exact
  // configured origin. Native clients use their explicit opaque bearer instead.
  if (!bearer && !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && c.req.header('origin') !== owner.publicOrigin) {
    return { ok: false, status: 403, error: 'invalid_session_origin' };
  }
  try {
    const grant = await owner.sessions.resolve(token);
    if (optsRef !== owner) return { ok: false, status: 503, error: 'authentication_unavailable' };
    return { ok: true, session: { token, grant }, identity: identityFromGrant(owner, grant) };
  } catch (error) {
    const denied = error instanceof ServiceSessionMissingError || (error instanceof CompositeAuthorityError && [401, 403].includes(error.status));
    if (denied && !bearer) clearServiceSessionCookie(c, secure);
    return { ok: false, status: denied ? 401 : 503, error: denied ? 'service_session_expired' : 'authority_unavailable' };
  }
}

async function authenticateExternalRoute(c: Context, external: ExternalServiceAuth): Promise<UserAuthResult | { ok: true; principal: ServicePrincipal }> {
  const bearer = extractBearerToken(c);
  const user = await resolveUserAuth(c, bearer && !isServiceTokenCandidate(bearer) ? bearer : null);
  if (user.ok || user.status === 403) return user;
  const serviceToken = extractServiceTokenCandidate(c, external.headerNames);
  if (!serviceToken) return user;
  const verification = await external.verifier.verify(serviceToken);
  switch (verification.status) {
    case 'ok': return { ok: true, principal: verification.principal };
    case 'invalid': return { ok: false, status: 401, error: 'invalid_service_token' };
    case 'unavailable': return { ok: false, status: 503, error: 'service_token_verifier_unavailable' };
  }
}

const NO_AUTH_IDENTITY: AuthIdentity = { userId: 'dev-user', externalId: 'dev-user', role: 'admin', displayName: 'Dev User (CORPUS_NO_AUTH)', projectKey: null, isAdmin: true };
export const requireAuth: MiddlewareHandler = async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  if (process.env.CORPUS_NO_AUTH === '1') {
    c.set('auth', NO_AUTH_IDENTITY);
    await next();
    return;
  }
  const owner = optsRef;
  if (!owner) return c.json({ error: 'authentication_unavailable' }, 503);
  const authorization = c.req.header('authorization');
  if (authorization?.toLowerCase().startsWith('cernere-upload ')) {
    const upload = authorization.slice('cernere-upload '.length), requestId = c.req.header('x-cernere-request-id') ?? '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(upload) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      return c.json({ error: 'invalid_upload_credential' }, 401);
    }
    return runServiceOperation(c, next, operationGate(owner), { upload, requestId });
  }
  if (authorization?.toLowerCase().startsWith('cernere-delegation ')) {
    const delegation = authorization.slice('cernere-delegation '.length);
    const requestId = c.req.header('x-cernere-request-id') ?? '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(delegation) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      return c.json({ error: 'invalid_delegation_credential' }, 401);
    }
    // Explicit capabilities never fall back to a browser cookie, user session or
    // machine token, and never create a session usable for further delegation.
    return runServiceOperation(c, next, operationGate(owner), { delegation, requestId });
  }
  if (authorization && !/^Bearer [^\s]+$/i.test(authorization)) return c.json({ error: 'invalid_authorization_scheme' }, 401);
  const external = owner.externalService;
  const result = external && matchExternalServiceRoute(c.req.path, external.modules)
    ? await authenticateExternalRoute(c, external) : await resolveUserAuth(c, extractBearerToken(c));
  if (!result.ok) return c.json({ error: result.error }, result.status);
  if ('principal' in result) {
    // Existing explicitly allowed machine routes retain their separate scope
    // authorization; a machine principal is never a user/delegation session.
    c.set('servicePrincipal', result.principal);
    await next();
    return;
  }
  c.set('auth', result.identity);
  c.set('serviceUserSession', result.session);
  return runServiceOperation(c, next, operationGate(owner), result);
};
export const requireAdmin: MiddlewareHandler = async (c, next) => {
  const identity = c.get('auth') as AuthIdentity | undefined;
  if (!identity) return c.json({ error: 'unauthorized' }, 401);
  if (!identity.isAdmin) return c.json({ error: 'admin_required' }, 403);
  await next();
};
export function getIdentity(c: Context): AuthIdentity {
  const identity = c.get('auth') as AuthIdentity | undefined;
  if (!identity) throw new Error(c.get('servicePrincipal') ? 'Request is authenticated as a service principal' : 'Corpus user authentication is missing');
  return identity;
}
export function getServicePrincipal(c: Context): ServicePrincipal | null { return (c.get('servicePrincipal') as ServicePrincipal | undefined) ?? null; }
export function getUserSession(c: Context): ServiceUserSession | null { return (c.get('serviceUserSession') as ServiceUserSession | undefined) ?? null; }
declare module 'hono' {
  interface ContextVariableMap { auth: AuthIdentity; serviceUserSession: ServiceUserSession; servicePrincipal: ServicePrincipal }
}
