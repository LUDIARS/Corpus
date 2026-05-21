// マニフェスト駆動コネクタ。
//
// 接続先サービスの /.well-known/corpus-service.json (D6) を読み、 そこに宣言
// された health / data エンドポイント / panel を扱う。 discovery (ローカル
// probe / サーバ設定) が見つけたサービスはこのコネクタとして登録される。
//
// プラグインが手動登録する HttpServiceConnector と違い、 サービス id / 表示名 /
// データエンドポイントはすべてマニフェスト由来。

import {
  fetchManifest,
  type CorpusServiceManifest,
  type ManifestDataEndpoint,
} from '../hub/manifest.ts';
import type {
  ConnectorHealth,
  ConnectorScope,
  ServiceConnector,
} from '../hub/types.ts';

const FETCH_TIMEOUT_MS = 5000;

async function timedFetch(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class ManifestConnector implements ServiceConnector {
  id: string;
  title: string;
  readonly scope: ConnectorScope;
  readonly baseUrl: string;
  private manifest: CorpusServiceManifest | null = null;

  constructor(opts: { baseUrl: string; scope: ConnectorScope; id?: string }) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.id = opts.id ?? this.baseUrl;
    this.title = this.id;
    this.scope = opts.scope;
  }

  /** マニフェストを取得し id / title / manifest を確定する。 成功で true。 */
  async init(): Promise<boolean> {
    const m = await fetchManifest(this.baseUrl);
    if (!m) return false;
    this.manifest = m;
    this.id = m.service;
    this.title = m.displayName;
    return true;
  }

  /** マニフェストを再取得する (discovery の定期更新用)。 */
  async refresh(): Promise<void> {
    const m = await fetchManifest(this.baseUrl);
    if (m) {
      this.manifest = m;
      this.id = m.service;
      this.title = m.displayName;
    }
  }

  getManifest(): CorpusServiceManifest | null {
    return this.manifest;
  }

  /** マニフェストの data[] から id で 1 件引く。 */
  findData(dataId: string): ManifestDataEndpoint | null {
    return this.manifest?.data.find((d) => d.id === dataId) ?? null;
  }

  async health(): Promise<ConnectorHealth> {
    const healthPath = this.manifest?.health ?? '/api/health';
    try {
      const res = await timedFetch(`${this.baseUrl}${healthPath}`);
      if (res.ok) return { status: 'up' };
      return { status: 'degraded', detail: `health ${res.status}` };
    } catch (e) {
      return { status: 'down', detail: (e as Error).message };
    }
  }

  async fetch(path: string, init?: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
    return timedFetch(url, init);
  }
}
