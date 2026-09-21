import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { connect, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';

import {
  attachCompositeWebSocketProxy,
  type CompositeWebSocketProxyDiagnostic,
} from './composite-ws-proxy.ts';

const servers: Server[] = [];
const sockets: Duplex[] = [];

let ipcSequence = 0;

/**
 * The browser-facing side of the proxy is served over an IPC endpoint (named
 * pipe on Windows, unix socket elsewhere) instead of an OS-assigned ephemeral
 * TCP port. The HTTP upgrade path exercised here is identical — `http.Server`
 * parses upgrades the same way on either transport — but a loopback TCP connect
 * to an ephemeral port intermittently fails with ETIMEDOUT (errno -4039) on the
 * review host, which fails this test for a reason that has nothing to do with
 * the proxy contract. The upstream leg below stays TCP because the proxy dials
 * an http(s) URL by contract, and faking that would stop proving the relay.
 */
function ipcEndpoint(): string {
  const name = `corpus-composite-ws-${process.pid}-${++ipcSequence}`;
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\${name}`
    : join(tmpdir(), `${name}.sock`);
}

function listenIpc(server: Server): Promise<string> {
  servers.push(server);
  const endpoint = ipcEndpoint();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(endpoint, () => resolve(endpoint));
  });
}

function listenTcp(server: Server): Promise<number> {
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
    const upstreamPort = await listenTcp(upstreamServer);

    const proxyServer = createServer((_request, response) => response.end('ok'));
    attachCompositeWebSocketProxy(
      proxyServer,
      `http://127.0.0.1:${upstreamPort}`,
      (diagnostic) => diagnostics.push(diagnostic),
    );
    const proxyEndpoint = await listenIpc(proxyServer);

    const client = connect(proxyEndpoint);
    // Connect first so a transport failure surfaces as a connect error instead
    // of being buffered into the request write and read back as a header stall.
    await once(client, 'connect');
    client.write([
      'GET /auth/composite-ws?ticket=must-not-be-forwarded HTTP/1.1',
      'Host: 127.0.0.1',
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
