import type { Hono, MiddlewareHandler } from 'hono';

/** Host-owned authorization runs after authentication, before every protected API.
 * Policies may deny requests or narrow responses; they cannot bypass requireAuth.
 * @implements SPEC-HOST-ACCESS-POLICY-001
 */
export function installHostAccessPolicy(app: Hono, policy?: MiddlewareHandler): void {
  if (!policy) return;
  app.use('/api/*', policy);
  app.use('/mcp', policy);
  app.use('/mcp/*', policy);
}

export interface CorpusStartOptions {
  /** Domain authorization belongs to the host, never to Corpus. */
  accessPolicy?: MiddlewareHandler;
}
