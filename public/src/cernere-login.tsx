import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CompositeLoginFrame } from '../../lib/cernere/packages/composite/src/ui/CompositeLoginFrame.tsx';
import { clearLegacyToken } from './api.ts';

interface PublicConfig { cernereFrontendUrl?: string; cernereClientId?: string }

/** The verifier stays in the service's browser context until this same-origin exchange.
 * @implements SPEC-HUB-BOUND-SERVICE-SESSION
 */
export async function completeServiceLogin(code: string, verifier: string, signal?: AbortSignal): Promise<void> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(code) || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new Error('新しいログインを開始してください');
  const timeout = AbortSignal.timeout(45_000);
  const response = await fetch('/auth/exchange', {
    method: 'POST', credentials: 'same-origin', redirect: 'error',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, code_verifier: verifier }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || data?.ok !== true || typeof data.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(data.expiresAt)) || Date.parse(data.expiresAt) <= Date.now() || Date.parse(data.expiresAt) > Date.now() + 900_000
    || ['accessToken', 'refreshToken', 'projectToken', 'sessionToken'].some(key => key in data)) {
    // The code may already be consumed. Do not retry or retain returned credentials.
    throw new Error('ログインを完了できませんでした。元の画面からやり直してください');
  }
  clearLegacyToken();
}

/** @implements SPEC-HUB-EMBEDDED-LOGIN-001 */
function EmbeddedLoginHost({ config, message, signal }: { config: Required<PublicConfig>; message: string; signal: AbortSignal }) {
  const [error, setError] = useState('');
  return <>
    {message && <p className="muted">{message}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <CompositeLoginFrame cernereUrl={config.cernereFrontendUrl} clientId={config.cernereClientId}
      onAuthCode={async (code, verifier) => {
        await completeServiceLogin(code, verifier, signal);
        if (!signal.aborted) window.location.reload();
      }} onError={cause => { if (!signal.aborted) setError(cause.message); }} />
  </>;
}
export { CompositeLoginFrame };

/** @implements SPEC-HUB-EMBEDDED-LOGIN-001 */
export function mountCernereLogin(mount: HTMLElement, message: string): () => void {
  const root = createRoot(mount);
  const lifetime = new AbortController();
  clearLegacyToken();
  root.render(<p className="muted">Cernere を読み込み中…</p>);
  void (async () => {
    try {
      const response = await fetch('/api/public-config', { credentials: 'same-origin', redirect: 'error',
        signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(10_000)]) });
      const config = await response.json() as PublicConfig;
      if (!response.ok || !config.cernereFrontendUrl || !config.cernereClientId) {
        throw new Error('サービスのログイン設定を取得できませんでした');
      }
      if (lifetime.signal.aborted) return;
      root.render(<EmbeddedLoginHost config={{ cernereFrontendUrl: config.cernereFrontendUrl, cernereClientId: config.cernereClientId }} message={message} signal={lifetime.signal} />);
    } catch (cause) {
      if (!lifetime.signal.aborted) root.render(<p className="error">{cause instanceof Error ? cause.message : 'ログイン画面を取得できませんでした'}</p>);
    }
  })();
  return () => { lifetime.abort(); root.unmount(); };
}
