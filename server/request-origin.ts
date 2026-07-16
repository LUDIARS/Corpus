import type { Context } from 'hono';

/**
 * Resolve the browser-facing origin while preserving the request host.
 * Cloudflare and other TLS-terminating proxies forward HTTPS as HTTP to the
 * local service and describe the original scheme with X-Forwarded-Proto.
 */
export function resolveRequestOrigin(c: Context): string {
  const url = new URL(c.req.url);
  const forwardedProto = c.req.header('x-forwarded-proto')
    ?.split(',', 1)[0]
    ?.trim()
    .toLowerCase();

  if (forwardedProto === 'http' || forwardedProto === 'https') {
    url.protocol = `${forwardedProto}:`;
  }

  return url.origin;
}
