import { describe, expect, it, vi } from 'vitest';

import { ProjectAuthClient } from './project-auth-client.ts';

class FakeSocket {
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  readonly sent: string[] = [];

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  emit(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

describe('ProjectAuthClient', () => {
  it('pre-authenticates the project before sending embedded login commands', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ accessToken: 'project-token' }));
    const socket = new FakeSocket();
    const client = new ProjectAuthClient({
      cernereBaseUrl: 'http://cernere.test',
      clientId: 'glab-client',
      clientSecret: 'secret',
      fetchImpl: fetchImpl as typeof fetch,
      createWebSocket: (url, protocols) => {
        expect(url).toBe('ws://cernere.test/ws/project');
        expect(protocols).toEqual(['bearer', 'project-token']);
        return socket;
      },
    });

    const connected = client.connect();
    await vi.waitFor(() => expect(socket.onmessage).not.toBeNull());
    socket.emit({ type: 'connected' });
    await connected;

    const login = client.authenticate('login', {
      email: 'user@example.test',
      password: 'password',
    });
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
    const request = JSON.parse(socket.sent[0] ?? '{}') as Record<string, unknown>;
    expect(request).toMatchObject({
      type: 'module_request',
      module: 'auth',
      action: 'login',
    });
    socket.emit({
      type: 'module_response',
      request_id: request.request_id,
      payload: { ticket: 'ticket-1', wsPath: '/auth/composite-ws' },
    });
    await expect(login).resolves.toEqual({
      ticket: 'ticket-1',
      wsPath: '/auth/composite-ws',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://cernere.test/api/auth/login',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
