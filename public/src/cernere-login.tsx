import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import {
  CompositeLogin,
  CompositePasskeyPopup,
  type CompositeAuthApi,
  type CompositeAuthResponse,
  type DeviceAnomaly,
  type DeviceFingerprint,
} from '../../lib/cernere/packages/composite/src/ui/index.ts';
import { setToken } from './api.ts';

interface CompositeStartResponse extends CompositeAuthResponse {
  ticket?: string;
  wsPath?: string;
}

interface PublicConfig {
  cernereBaseUrl?: string;
  cernereFrontendUrl?: string;
  authUiMode?: 'composite' | 'passkey';
}

type PendingKind = 'authenticate' | 'verify' | 'resend';

interface PendingRequest {
  resolve: (response: CompositeAuthResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type CompositeServerMessage =
  | {
      type: 'state';
      state: string;
      data?: {
        deviceToken?: string;
        emailMasked?: string;
        anomalies?: DeviceAnomaly[];
        codeChannel?: 'email' | 'console';
        deviceLabel?: string;
        error?: string;
        remainingAttempts?: number;
      };
    }
  | { type: 'authenticated'; authCode: string }
  | { type: 'error'; retryable: boolean; reason: string }
  | { type: 'ping'; ts: number };

export interface CernereCompositeClientDeps {
  fetch?: typeof fetch;
  openWebSocket?: (url: string, protocols: string[]) => WebSocket;
}

const WS_OPEN = 1;
const REQUEST_TIMEOUT_MS = 30_000;

/** 現行 Cernere の ticket WebSocket を公開 CompositeLogin の authApi に変換する。 */
export class CernereCompositeAuthClient implements CompositeAuthApi {
  private readonly fetchImpl: typeof fetch;
  private readonly openWebSocket: (url: string, protocols: string[]) => WebSocket;
  private socket: WebSocket | null = null;
  private pending: PendingRequest | null = null;
  private deviceToken = '';

  constructor(
    private readonly cernereBaseUrl: string,
    deps: CernereCompositeClientDeps = {},
  ) {
    const fetchImpl = deps.fetch ?? globalThis.fetch;
    this.fetchImpl = fetchImpl.bind(globalThis);
    this.openWebSocket =
      deps.openWebSocket ?? ((url, protocols) => new WebSocket(url, protocols));
  }

  login(params: {
    email: string;
    password: string;
    device?: DeviceFingerprint;
  }): Promise<CompositeAuthResponse> {
    return this.start('login', params, params.device);
  }

  register(params: {
    name: string;
    email: string;
    password: string;
    device?: DeviceFingerprint;
  }): Promise<CompositeAuthResponse> {
    return this.start('register', params, params.device);
  }

  mfaVerify(params: {
    mfaToken: string;
    method: string;
    code: string;
    device?: DeviceFingerprint;
  }): Promise<CompositeAuthResponse> {
    return this.start('mfa-verify', params, params.device);
  }

  deviceVerify(params: {
    deviceToken: string;
    code: string;
  }): Promise<CompositeAuthResponse> {
    this.assertActiveChallenge(params.deviceToken);
    return this.sendAndWait('verify', {
      type: 'verify_code',
      code: params.code,
    });
  }

  deviceResend(params: { deviceToken: string }): Promise<CompositeAuthResponse> {
    this.assertActiveChallenge(params.deviceToken);
    return this.sendAndWait('resend', { type: 'resend' });
  }

  dispose(): void {
    this.rejectPending(new Error('Authentication was cancelled'));
    this.socket?.close(1000, 'disposed');
    this.socket = null;
    this.deviceToken = '';
  }

  private async start(
    action: 'login' | 'register' | 'mfa-verify',
    params: Record<string, unknown>,
    device: DeviceFingerprint | undefined,
  ): Promise<CompositeAuthResponse> {
    this.dispose();
    const response = await this.post<CompositeStartResponse>(
      `/auth/composite/${action}`,
      params,
    );
    if (response.mfaRequired) return response;
    if (!response.ticket || !response.wsPath) {
      throw new Error('Cernere did not return a composite session');
    }
    if (!device) {
      throw new Error('Device information could not be collected');
    }
    return this.openSession(response.ticket, response.wsPath, device);
  }

  private openSession(
    ticket: string,
    wsPath: string,
    device: DeviceFingerprint,
  ): Promise<CompositeAuthResponse> {
    const url = new URL(wsPath, this.cernereBaseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.delete('ticket');

    const result = this.waitFor('authenticate');
    const socket = this.openWebSocket(url.toString(), ['ticket', ticket]);
    this.socket = socket;
    socket.onmessage = (event) => {
      let message: CompositeServerMessage;
      try {
        message = JSON.parse(String(event.data)) as CompositeServerMessage;
      } catch {
        return;
      }
      this.handleMessage(message, device);
    };
    socket.onerror = () => {
      this.rejectPending(new Error('Cernere WebSocket connection failed'));
    };
    socket.onclose = (event) => {
      if (this.socket === socket) this.socket = null;
      if (this.pending) {
        this.rejectPending(
          new Error(event.reason || 'Cernere WebSocket connection closed'),
        );
      }
    };
    return result;
  }

  private handleMessage(
    message: CompositeServerMessage,
    device: DeviceFingerprint,
  ): void {
    if (message.type === 'ping') {
      if (this.socket?.readyState === WS_OPEN) {
        this.socket.send(JSON.stringify({ type: 'pong', ts: message.ts }));
      }
      return;
    }
    if (message.type === 'error') {
      this.rejectPending(new Error(message.reason));
      return;
    }
    if (message.type === 'authenticated') {
      this.resolvePending({ authCode: message.authCode });
      return;
    }
    if (message.state === 'pending_device') {
      this.socket?.send(JSON.stringify({ type: 'device', payload: device }));
      return;
    }
    if (message.state !== 'challenge_pending') return;

    const data = message.data ?? {};
    if (data.deviceToken) this.deviceToken = data.deviceToken;
    if (!this.deviceToken) {
      this.rejectPending(new Error('Cernere did not return a device challenge'));
      return;
    }
    this.resolvePending({
      deviceVerificationRequired: true,
      deviceToken: this.deviceToken,
      emailMasked: data.emailMasked,
      anomalies: data.anomalies,
      codeChannel: data.codeChannel,
      deviceLabel: data.deviceLabel,
      error: data.error,
      remainingAttempts: data.remainingAttempts,
    });
  }

  private sendAndWait(
    kind: Exclude<PendingKind, 'authenticate'>,
    message: Record<string, unknown>,
  ): Promise<CompositeAuthResponse> {
    if (!this.socket || this.socket.readyState !== WS_OPEN) {
      return Promise.reject(new Error('Cernere authentication session is not connected'));
    }
    const result = this.waitFor(kind);
    this.socket.send(JSON.stringify(message));
    return result;
  }

  private waitFor(_kind: PendingKind): Promise<CompositeAuthResponse> {
    if (this.pending) {
      return Promise.reject(new Error('Another authentication request is in progress'));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.rejectPending(new Error('Cernere authentication timed out'));
      }, REQUEST_TIMEOUT_MS);
      this.pending = { resolve, reject, timer };
    });
  }

  private resolvePending(response: CompositeAuthResponse): void {
    const pending = this.pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending = null;
    pending.resolve(response);
  }

  private rejectPending(error: Error): void {
    const pending = this.pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending = null;
    pending.reject(error);
  }

  private assertActiveChallenge(deviceToken: string): void {
    if (!deviceToken || deviceToken !== this.deviceToken) {
      throw new Error('Cernere device challenge is no longer active');
    }
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await this.fetchImpl(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as T & {
      error?: string;
    };
    if (!response.ok) {
      throw new Error(data.error || `Cernere request failed (${response.status})`);
    }
    return data;
  }
}

async function exchangeAuthCode(authCode: string): Promise<void> {
  const response = await fetch('/auth/exchange', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: authCode }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    accessToken?: string;
    error?: string;
  };
  if (!response.ok || !data.accessToken) {
    throw new Error(data.error || 'Cernere token exchange failed');
  }
  setToken(data.accessToken);
  location.reload();
}

function LoginHost({
  client,
  message,
}: {
  client: CernereCompositeAuthClient;
  message: string;
}) {
  const [error, setError] = useState('');
  return (
    <>
      {error && <p className="error">{error}</p>}
      <CompositeLogin
        authApi={client}
        onAuthCode={(code) => {
          setError('');
          void exchangeAuthCode(code).catch((cause: unknown) => {
            setError(cause instanceof Error ? cause.message : String(cause));
          });
        }}
        labels={{
          title: 'Officina - GLab',
          subtitle: message || 'ログインはここから',
          loginTab: 'ログイン',
          registerTab: '新規登録',
          name: '名前',
          email: 'メールアドレス',
          password: 'パスワード',
          submitLogin: 'ログイン',
          submitRegister: 'アカウントを作成',
          processing: '処理中…',
          deviceTitle: '本人確認',
          deviceCode: '確認コード',
          deviceSubmit: '確認する',
          deviceResend: 'コードを再送',
        }}
      />
    </>
  );
}

function PasskeyLoginHost({
  cernereFrontendUrl,
  message,
}: {
  cernereFrontendUrl: string;
  message: string;
}) {
  const [error, setError] = useState('');
  return (
    <>
      <h1>Officina - GLab</h1>
      <p className="muted">{message || 'ログインはここから'}</p>
      {error && <p className="error">{error}</p>}
      <CompositePasskeyPopup
        cernereUrl={cernereFrontendUrl}
        className="primary"
        buttonLabel="ログイン"
        onError={(cause) => setError(cause.message)}
        onAuthCode={async (code) => {
          setError('');
          await exchangeAuthCode(code);
        }}
      />
    </>
  );
}

/** Cernere の公開設定を読み、組み込みログインUIを mount する。 */
export function mountCernereLogin(
  mount: HTMLElement,
  message: string,
): () => void {
  const root = createRoot(mount);
  let disposed = false;
  let client: CernereCompositeAuthClient | null = null;
  root.render(<p className="muted">Cernere を読み込み中…</p>);

  void (async () => {
    try {
      const response = await fetch('/api/public-config');
      const config = (await response.json()) as PublicConfig;
      if (!response.ok || !config.cernereBaseUrl) {
        throw new Error('Cernere の接続先を取得できませんでした');
      }
      if (disposed) return;
      if (config.authUiMode === 'passkey') {
        if (!config.cernereFrontendUrl) {
          throw new Error('Cernere ログイン画面の接続先を取得できませんでした');
        }
        root.render(
          <PasskeyLoginHost
            cernereFrontendUrl={config.cernereFrontendUrl}
            message={message}
          />,
        );
        return;
      }
      client = new CernereCompositeAuthClient(config.cernereBaseUrl);
      root.render(<LoginHost client={client} message={message} />);
    } catch (cause) {
      if (!disposed) {
        root.render(
          <p className="error">
            {cause instanceof Error ? cause.message : String(cause)}
          </p>,
        );
      }
    }
  })();

  return () => {
    disposed = true;
    client?.dispose();
    root.unmount();
  };
}
