/** Downstream calls receive one prepared, operation-bound Cr capability.
 * No global user token, passthrough or cached positive authorization.
 * @implements SPEC-HUB-BOUND-SERVICE-SESSION
 */
import type { ServiceUserSession } from '../auth.ts';
import type { ServiceSessionStore } from '../service-session-store.ts';
import type { DelegatedHttpOperation } from '../../lib/cernere/packages/composite/src/delegation.js';
import { requireUploadLimits } from '../../lib/cernere/packages/composite/src/upload-body.js';
import type { AuthorizedUploadBody } from '../service-upload-gate.ts';
import { openBlobTransfer } from '../upload-transfer.ts';

export interface DownstreamTarget { service: string; projectKey: string; baseUrl: string }
export interface DownstreamRequest { path: string; action: string; init?: RequestInit; additionalHeaders?: readonly string[]; upload?: AuthorizedUploadBody }
export interface AuthorizedDownstreamRequest { path: string; init: RequestInit; dispose?: () => Promise<void> }
type DelegationSessions = Pick<ServiceSessionStore, 'delegate'> & Partial<Pick<ServiceSessionStore, 'delegateUpload'>>;
export interface TokenProvider {
  readonly mode: string;
  authorize(session: ServiceUserSession | null, target: DownstreamTarget, request: DownstreamRequest): Promise<AuthorizedDownstreamRequest | null>;
}

/** Explicit no-user dev mode still refuses authenticated downstream requests. */
export class DisabledUserDelegation implements TokenProvider {
  readonly mode = 'none';
  async authorize(): Promise<null> { return null; }
}
export class CernereDelegationTokenProvider implements TokenProvider {
  readonly mode = 'cernere-service-delegation';
  constructor(private readonly sessions: DelegationSessions) {}

  async authorize(session: ServiceUserSession | null, target: DownstreamTarget, operation: DownstreamRequest): Promise<AuthorizedDownstreamRequest | null> {
    if (!session || !target.projectKey || !target.baseUrl || !operation.action) return null;
    try {
      const base = new URL(target.baseUrl);
      if (base.username || base.password || base.search || base.hash || !(base.protocol === 'https:'
        || (base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))) throw new Error('Invalid downstream URL');
      const prefix = base.pathname.replace(/\/+$/, '');
      const connectorPath = operation.path;
      if (!connectorPath.startsWith('/')) throw new Error('Absolute service-relative path required');
      const path = prefix + connectorPath;
      const url = new URL(path, base.origin);
      if (url.origin !== base.origin || url.pathname + url.search !== path || url.hash) throw new Error('Noncanonical downstream request');
      const headers = new Headers(operation.init?.headers);
      for (const secret of ['authorization', 'proxy-authorization', 'cookie']) headers.delete(secret);
      // Explicit defaults avoid differences introduced by the HTTP implementation.
      if (!headers.has('accept')) headers.set('accept', '*/*');
      if (!headers.has('accept-language')) headers.set('accept-language', '*');
      const upload = operation.upload;
      if (upload && operation.init?.body !== upload.body) throw new Error('The exact authorized upload Blob is required');
      if (upload) headers.set('content-length', String(upload.body.size));
      // Upload capture is already serialized; do not create/read a second body
      // stream or materialize 2 GiB through Request.arrayBuffer().
      const prepared = new Request(url, { ...operation.init, ...(upload ? { body: undefined } : {}), headers, credentials: 'omit', redirect: 'error' });
      if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(prepared.method)) throw new Error('Unclassified HTTP method');
      // Platform Request serializes FormData once, including the boundary. Forward
      // these exact bytes and headers, rather than independently serializing again.
      const body = upload?.body ?? new Uint8Array(await prepared.arrayBuffer());
      prepared.signal.throwIfAborted();
      const request = { action: operation.action, method: prepared.method as DelegatedHttpOperation['method'],
        path, resource: path, body, headers: prepared.headers, additionalHeaders: operation.additionalHeaders };
      let credential: { token: string; requestId: string };
      if (upload) {
        const limits = requireUploadLimits(upload);
        if (!this.sessions.delegateUpload || ['GET', 'HEAD'].includes(prepared.method) || !(body instanceof Blob) || body.size > limits.maximumBytes) throw new Error('Bounded upload delegation is unavailable');
        const issued = await this.sessions.delegateUpload(session.token, { projectKey: target.projectKey, audience: base.origin }, { ...request, body }, prepared.signal);
        credential = { token: issued.arrivalToken, requestId: issued.requestId };
        const transfer = new AbortController();
        const forwarding = new Headers(prepared.headers);
        forwarding.set('authorization', `Cernere-Upload ${credential.token}`); forwarding.set('x-cernere-request-id', credential.requestId);
        prepared.signal.throwIfAborted();
        const signal = AbortSignal.any([prepared.signal, transfer.signal, AbortSignal.timeout(limits.timeoutSeconds * 1000)]);
        const outgoing = openBlobTransfer(body, signal);
        return { path: connectorPath, dispose: async () => { transfer.abort(); await outgoing.dispose(); },
          init: { ...operation.init, method: prepared.method, headers: forwarding, credentials: 'omit', redirect: 'error',
            body: outgoing.body, duplex: 'half', signal } as RequestInit };
      }
      const issued = await this.sessions.delegate(session.token, { projectKey: target.projectKey, audience: base.origin }, { ...request, body: body as Uint8Array });
      credential = { token: issued.delegationToken, requestId: issued.requestId };
      prepared.signal.throwIfAborted();
      const forwarding = new Headers(prepared.headers);
      forwarding.set('authorization', `Cernere-Delegation ${credential.token}`);
      forwarding.set('x-cernere-request-id', credential.requestId);
      return { path: connectorPath, init: { ...operation.init, method: prepared.method, headers: forwarding,
        credentials: 'omit', redirect: 'error', body: ['GET', 'HEAD'].includes(prepared.method) ? undefined : body,
        signal: AbortSignal.any([prepared.signal, AbortSignal.timeout(15_000)]) } };
    } catch {
      // Errors may contain credentials or private URLs. The caller returns a
      // controlled unavailable result; it must never perform an anonymous fetch.
      return null;
    }
  }
}
export function makeTokenProvider(mode: string | undefined, sessions: DelegationSessions | null, options: { noAuth?: boolean } = {}): TokenProvider {
  const selected = mode?.trim();
  if (options.noAuth && (!selected || selected === 'none')) return new DisabledUserDelegation();
  if (selected === 'cernere-service-delegation' && sessions) return new CernereDelegationTokenProvider(sessions);
  throw new Error('CORPUS_TOKEN_MODE=cernere-service-delegation and bound source sessions are required; none is allowed only with explicit no-auth dev mode');
}
