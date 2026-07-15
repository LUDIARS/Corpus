import type { IncomingMessage, Server } from 'node:http';
import { connect as connectTcp, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { connect as connectTls, type TLSSocket } from 'node:tls';

const COMPOSITE_WS_PATH = '/auth/composite-ws';

type UpstreamSocket = Socket | TLSSocket;

export type CompositeWebSocketProxyDiagnostic =
  | { event: 'client_upgrade_received' }
  | { event: 'client_upgrade_rejected'; status: 400 | 404; reason: 'path' | 'headers' }
  | { event: 'upstream_connected' }
  | { event: 'upstream_response'; status: number }
  | { event: 'upstream_response_invalid' }
  | { event: 'upstream_error'; code: string };

type DiagnosticSink = (diagnostic: CompositeWebSocketProxyDiagnostic) => void;

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(', ') : value;
}

function hasTicketProtocol(request: IncomingMessage): boolean {
  const header = headerValue(request.headers['sec-websocket-protocol']);
  if (!header) return false;
  const protocols = header.split(',').map((value) => value.trim()).filter(Boolean);
  const [scheme, ticket] = protocols;
  return protocols.length === 2 && scheme === 'ticket' && Boolean(ticket);
}

function rejectUpgrade(socket: Duplex, status: string): void {
  if (!socket.writable) {
    socket.destroy();
    return;
  }
  socket.end(
    `HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

function buildUpstreamRequest(request: IncomingMessage, upstream: URL): string {
  const lines = [
    `GET ${COMPOSITE_WS_PATH} HTTP/1.1`,
    `Host: ${upstream.host}`,
    'Connection: Upgrade',
    'Upgrade: websocket',
    `Sec-WebSocket-Key: ${headerValue(request.headers['sec-websocket-key']) ?? ''}`,
    `Sec-WebSocket-Version: ${headerValue(request.headers['sec-websocket-version']) ?? '13'}`,
    `Sec-WebSocket-Protocol: ${headerValue(request.headers['sec-websocket-protocol']) ?? ''}`,
  ];
  const extensions = headerValue(request.headers['sec-websocket-extensions']);
  if (extensions) lines.push(`Sec-WebSocket-Extensions: ${extensions}`);
  const origin = headerValue(request.headers.origin);
  if (origin) lines.push(`Origin: ${origin}`);
  return `${lines.join('\r\n')}\r\n\r\n`;
}

function resolveUpstream(cernereBaseUrl: string): { url: URL; secure: boolean; port: number } {
  const url = new URL(cernereBaseUrl);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('CERNERE_BASE_URL must not contain credentials, query, or fragment');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('CERNERE_BASE_URL must use http or https');
  }
  const secure = url.protocol === 'https:';
  return {
    url,
    secure,
    port: url.port ? Number(url.port) : secure ? 443 : 80,
  };
}

function relayUpstreamResponse(
  upstream: UpstreamSocket,
  client: Duplex,
  diagnose: DiagnosticSink,
): void {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  const onData = (chunk: Buffer): void => {
    chunks.push(chunk);
    totalBytes += chunk.length;
    const response = Buffer.concat(chunks, totalBytes);
    const lineEnd = response.indexOf('\r\n');
    if (lineEnd < 0 && totalBytes <= 8_192) {
      upstream.once('data', onData);
      return;
    }

    const statusMatch = lineEnd < 0
      ? null
      : /^HTTP\/1\.[01] (\d{3})(?: |\r?$)/.exec(response.subarray(0, lineEnd).toString('ascii'));
    if (statusMatch) {
      diagnose({ event: 'upstream_response', status: Number(statusMatch[1]) });
    } else {
      diagnose({ event: 'upstream_response_invalid' });
    }
    if (client.writable) client.write(response);
    upstream.pipe(client);
  };

  upstream.once('data', onData);
}

/**
 * Browser-facing composite WebSocket upgrades are relayed through Corpus so
 * internal Cernere topology never needs to be reachable from the browser.
 */
export function attachCompositeWebSocketProxy(
  server: Server,
  cernereBaseUrl: string,
  diagnose: DiagnosticSink = () => {},
): void {
  const upstream = resolveUpstream(cernereBaseUrl);

  server.on('upgrade', (request, client, head) => {
    diagnose({ event: 'client_upgrade_received' });
    const path = new URL(request.url ?? '/', 'http://corpus.invalid').pathname;
    if (path !== COMPOSITE_WS_PATH) {
      diagnose({ event: 'client_upgrade_rejected', status: 404, reason: 'path' });
      rejectUpgrade(client, '404 Not Found');
      return;
    }
    if (
      request.headers.upgrade?.toLowerCase() !== 'websocket'
      || !headerValue(request.headers['sec-websocket-key'])
      || !hasTicketProtocol(request)
    ) {
      diagnose({ event: 'client_upgrade_rejected', status: 400, reason: 'headers' });
      rejectUpgrade(client, '400 Bad Request');
      return;
    }

    const onConnected = (socket: UpstreamSocket): void => {
      diagnose({ event: 'upstream_connected' });
      socket.write(buildUpstreamRequest(request, upstream.url));
      if (head.length > 0) socket.write(head);
      client.pipe(socket);
      relayUpstreamResponse(socket, client, diagnose);
    };

    const socket: UpstreamSocket = upstream.secure
      ? connectTls(
          { host: upstream.url.hostname, port: upstream.port, servername: upstream.url.hostname },
          function onSecureConnect(this: TLSSocket) { onConnected(this); },
        )
      : connectTcp(
          { host: upstream.url.hostname, port: upstream.port },
          function onConnect(this: Socket) { onConnected(this); },
        );

    socket.on('error', (error: NodeJS.ErrnoException) => {
      diagnose({ event: 'upstream_error', code: error.code ?? 'UNKNOWN' });
      client.destroy();
    });
    client.on('error', () => socket.destroy());
    client.on('close', () => socket.destroy());
    socket.on('close', () => client.destroy());
  });
}
