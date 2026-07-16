import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

const REQUEST_TIMEOUT_MS = 10_000;
const WS_OPEN = 1;

interface WsLike {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

interface PendingRequest {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface ProjectAuthClientConfig {
  cernereBaseUrl: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
  createWebSocket?: (url: string, protocols: string[]) => WsLike;
  requestTimeoutMs?: number;
}

export type CompositeAuthAction = 'login' | 'register' | 'mfa-verify';

function defaultCreateWebSocket(url: string, protocols: string[]): WsLike {
  return new WebSocket(url, protocols) as unknown as WsLike;
}

export class ProjectAuthClient {
  private readonly cernereBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly createWebSocket: (url: string, protocols: string[]) => WsLike;
  private readonly requestTimeoutMs: number;
  private ws: WsLike | null = null;
  private connectPromise: Promise<void> | null = null;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(private readonly config: ProjectAuthClientConfig) {
    if (!config.cernereBaseUrl.trim()) throw new Error('cernereBaseUrl is required');
    if (!config.clientId.trim()) throw new Error('clientId is required');
    if (!config.clientSecret.trim()) throw new Error('clientSecret is required');
    this.cernereBaseUrl = config.cernereBaseUrl.replace(/\/+$/, '');
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.createWebSocket = config.createWebSocket ?? defaultCreateWebSocket;
    this.requestTimeoutMs = config.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  async connect(): Promise<void> {
    await this.ensureConnected();
  }

  async authenticate(
    action: CompositeAuthAction,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request('auth', action, payload);
  }

  close(): void {
    this.rejectPending(new Error('Cernere project auth client closed'));
    this.ws?.close(1000, 'closed');
    this.ws = null;
    this.connectPromise = null;
  }

  private async request(
    module: string,
    action: string,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    await this.ensureConnected();
    const ws = this.ws;
    if (!ws || ws.readyState !== WS_OPEN) {
      throw new Error('Cernere project WebSocket is not connected');
    }
    const requestId = `corpus-auth-${randomUUID()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Cernere request timed out: ${module}.${action}`));
      }, this.requestTimeoutMs);
      timer.unref?.();
      this.pending.set(requestId, { resolve, reject, timer });
      try {
        ws.send(JSON.stringify({
          type: 'module_request',
          request_id: requestId,
          module,
          action,
          payload,
        }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private async ensureConnected(): Promise<void> {
    if (this.ws?.readyState === WS_OPEN) return;
    if (!this.connectPromise) {
      this.connectPromise = this.openProjectSession().finally(() => {
        this.connectPromise = null;
      });
    }
    await this.connectPromise;
  }

  private async openProjectSession(): Promise<void> {
    const token = await this.fetchProjectToken();
    const wsUrl = `${this.cernereBaseUrl.replace(/^http/i, 'ws')}/ws/project`;
    await new Promise<void>((resolve, reject) => {
      const ws = this.createWebSocket(wsUrl, ['bearer', token]);
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.ws = null;
        ws.close();
        reject(new Error('Cernere project WebSocket authentication timed out'));
      }, this.requestTimeoutMs);
      timer.unref?.();
      this.ws = ws;
      ws.onmessage = (event) => {
        const message = parseMessage(event.data);
        if (!message) return;
        if (message.type === 'connected' && !settled) {
          settled = true;
          clearTimeout(timer);
          resolve();
          return;
        }
        if (message.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', ts: message.ts }));
          return;
        }
        this.handleResponse(message);
      };
      ws.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.ws = null;
        reject(new Error('Cernere project WebSocket connection failed'));
      };
      ws.onclose = (event) => {
        this.ws = null;
        this.rejectPending(new Error(`Cernere project WebSocket closed (${event.code})`));
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error('Cernere project WebSocket closed before authentication'));
        }
      };
    });
  }

  private async fetchProjectToken(): Promise<string> {
    const response = await this.fetchImpl(`${this.cernereBaseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'project_credentials',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      }),
    });
    if (!response.ok) {
      throw new Error(`Cernere project login failed: HTTP ${response.status}`);
    }
    const body = await response.json() as { accessToken?: unknown };
    if (typeof body.accessToken !== 'string' || !body.accessToken) {
      throw new Error('Cernere project login response is missing accessToken');
    }
    return body.accessToken;
  }

  private handleResponse(message: Record<string, unknown>): void {
    const requestId = typeof message.request_id === 'string' ? message.request_id : null;
    if (!requestId) return;
    const pending = this.pending.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    if (message.type === 'module_response') {
      pending.resolve(message.payload ?? {});
      return;
    }
    pending.reject(new Error(
      typeof message.message === 'string' ? message.message : 'Cernere request failed',
    ));
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function parseMessage(raw: unknown): Record<string, unknown> | null {
  try {
    return JSON.parse(String(raw)) as Record<string, unknown>;
  } catch {
    return null;
  }
}
