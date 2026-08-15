import type { Context } from 'hono';

/**
 * Resolve the browser-facing origin from the request the browser actually made.
 * Cloudflare and other TLS-terminating proxies forward HTTPS as HTTP to the
 * local service and describe the original scheme with X-Forwarded-Proto, so the
 * scheme is restored from that header while the host is taken from the request.
 *
 * The host comes out normalized (lower-cased) because it is parsed by the
 * WHATWG URL parser, which is deliberate rather than incidental: this value is
 * handed to the browser as a base URL, so it must not be assembled from the raw
 * Host header. Host names are case-insensitive, so normalizing costs nothing.
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
