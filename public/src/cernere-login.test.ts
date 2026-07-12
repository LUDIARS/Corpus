import { describe, expect, it, vi } from 'vitest';

import {
  CernereCompositeAuthClient,
  type CernereCompositeClientDeps,
} from './cernere-login.tsx';

class FakeSocket {
  readonly sent: string[] = [];
  readyState = 1;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {}

  send(data: string): void {
    this.sent.push(data);
  }

  close(_code?: number, reason = ''): void {
    this.readyState = 3;
    this.onclose?.({ reason } as CloseEvent);
  }

  emit(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }
}

const device = {
  machine: {
    os: 'Windows 11',
    platform: 'Win32',
    screen: '1920x1080',
    timezone: 'Asia/Tokyo',
    language: 'ja',
  },
  browser: {
    ua: 'test',
    vendor: 'test',
    browser: 'Test',
    version: '1',
  },
};

describe('CernereCompositeAuthClient', () => {
  it('invokes fetch with the browser global as its receiver', async () => {
    const openWebSocket = vi.fn();
    const fetchMock = vi.fn(function (this: unknown) {
      if (this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      return Promise.resolve(
        Response.json({ error: 'Invalid email or password' }, { status: 401 }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const client = new CernereCompositeAuthClient('http://127.0.0.1:8080', {
        openWebSocket,
      });

      await expect(
        client.login({
          email: 'user@example.com',
          password: 'wrong-password',
          device,
        }),
      ).rejects.toThrow('Invalid email or password');
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(openWebSocket).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('adapts the ticket WebSocket challenge to CompositeLogin authApi', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        deviceVerificationRequired: true,
        ticket: 'ticket-123',
        wsPath: '/auth/composite-ws?ticket=ticket-123',
      }),
    );
    let socket: FakeSocket | undefined;
    const deps: CernereCompositeClientDeps = {
      fetch: fetchMock as typeof fetch,
      openWebSocket: (url, protocols) => {
        socket = new FakeSocket(url, protocols);
        return socket as unknown as WebSocket;
      },
    };
    const client = new CernereCompositeAuthClient('http://127.0.0.1:8080', deps);

    const login = client.login({
      email: 'user@example.com',
      password: 'password',
      device,
    });
    await vi.waitFor(() => expect(socket).toBeDefined());

    expect(socket?.url).toBe('ws://127.0.0.1:8080/auth/composite-ws');
    expect(socket?.protocols).toEqual(['ticket', 'ticket-123']);
    socket?.emit({ type: 'state', state: 'pending_device' });
    expect(JSON.parse(socket?.sent[0] ?? '{}')).toEqual({
      type: 'device',
      payload: device,
    });

    socket?.emit({
      type: 'state',
      state: 'challenge_pending',
      data: {
        deviceToken: 'device-123',
        emailMasked: 'u***@example.com',
        anomalies: ['new_device'],
      },
    });
    await expect(login).resolves.toMatchObject({
      deviceVerificationRequired: true,
      deviceToken: 'device-123',
    });

    const verify = client.deviceVerify({
      deviceToken: 'device-123',
      code: '123456',
    });
    expect(JSON.parse(socket?.sent[1] ?? '{}')).toEqual({
      type: 'verify_code',
      code: '123456',
    });
    socket?.emit({ type: 'authenticated', authCode: 'auth-code-123' });
    await expect(verify).resolves.toEqual({ authCode: 'auth-code-123' });
  });

  it('surfaces upstream errors without opening a WebSocket', async () => {
    const openWebSocket = vi.fn();
    const client = new CernereCompositeAuthClient('http://127.0.0.1:8080', {
      fetch: vi.fn(async () =>
        Response.json({ error: 'Invalid email or password' }, { status: 401 }),
      ) as typeof fetch,
      openWebSocket,
    });

    await expect(
      client.login({
        email: 'user@example.com',
        password: 'wrong-password',
        device,
      }),
    ).rejects.toThrow('Invalid email or password');
    expect(openWebSocket).not.toHaveBeenCalled();
  });
});
