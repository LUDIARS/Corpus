import { createServer, type Server } from 'node:http';
import { connect, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';

import {
  attachCompositeWebSocketProxy,
  type CompositeWebSocketProxyDiagnostic,
} from './composite-ws-proxy.ts';

const servers: Server[] = [];
const sockets: Duplex[] = [];

function listen(server: Server): Promise<number> {
  servers.push(server);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function readHeaders(socket: Socket): Promise<string> {
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    let response = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      response += chunk;
      if (response.includes('\r\n\r\n')) resolve(response);
    });
    socket.once('error', reject);
  });
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
});

describe('attachCompositeWebSocketProxy', () => {
  it('relays the fixed composite path and ticket subprotocol to Cernere', async () => {
    let upstreamPath = '';
    let upstreamProtocol = '';
    const diagnostics: CompositeWebSocketProxyDiagnostic[] = [];
    const upstreamServer = createServer();
    upstreamServer.on('upgrade', (request, socket) => {
      sockets.push(socket);
      upstreamPath = request.url ?? '';
      upstreamProtocol = String(request.headers['sec-websocket-protocol'] ?? '');
      socket.write([
        'HTTP/1.1 101 Switching Protocols',
        'Connection: Upgrade',
        'Upgrade: websocket',
        'Sec-WebSocket-Protocol: ticket',
        '',
        '',
      ].join('\r\n'));
    });
    const upstreamPort = await listen(upstreamServer);

    const proxyServer = createServer((_request, response) => response.end('ok'));
    attachCompositeWebSocketProxy(
      proxyServer,
      `http://127.0.0.1:${upstreamPort}`,
      (diagnostic) => diagnostics.push(diagnostic),
    );
    const proxyPort = await listen(proxyServer);

    const client = connect(proxyPort, '127.0.0.1');
    client.write([
      'GET /auth/composite-ws?ticket=must-not-be-forwarded HTTP/1.1',
      `Host: 127.0.0.1:${proxyPort}`,
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version: 13',
      'Sec-WebSocket-Protocol: ticket, ticket-123',
      '',
      '',
    ].join('\r\n'));

    await expect(readHeaders(client)).resolves.toContain('101 Switching Protocols');
    expect(upstreamPath).toBe('/auth/composite-ws');
    expect(upstreamProtocol).toBe('ticket, ticket-123');
    expect(diagnostics).toEqual([
      { event: 'client_upgrade_received' },
      { event: 'upstream_connected' },
      { event: 'upstream_response', status: 101 },
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain('ticket-123');
  });
});
