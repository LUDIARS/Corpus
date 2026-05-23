// 組み込みコネクタ + 再利用可能なコネクタ実装。
//
// HttpServiceConnector は「ある LUDIARS サービスの multi-hub backend を HTTP で
// 叩くだけ」 の汎用コネクタ。 プラグインモジュールはこれを new するだけで
// コネクタを 1 本足せる (VantanHub の facility/curriculum/schedule が利用)。

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

export interface HttpConnectorOptions {
  id: string;
  title: string;
  scope: ConnectorScope;
  /** 接続先サービスのベース URL。 空文字なら「未設定」 として degraded を返す。 */
  baseUrl: string;
  /** health 用パス。 既定 '/api/health'。 */
  healthPath?: string;
  /** 全リクエストに付けるヘッダ (サービス間 Bearer 等)。 */
  headers?: Record<string, string>;
}

/** HTTP で接続先サービスを叩く汎用コネクタ。 */
export class HttpServiceConnector implements ServiceConnector {
  readonly id: string;
  readonly title: string;
  readonly scope: ConnectorScope;
  readonly baseUrl: string;
  private readonly healthPath: string;
  private readonly headers: Record<string, string>;

  constructor(opts: HttpConnectorOptions) {
    this.id = opts.id;
    this.title = opts.title;
    this.scope = opts.scope;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.healthPath = opts.healthPath ?? '/api/health';
    this.headers = opts.headers ?? {};
  }

  async health(): Promise<ConnectorHealth> {
    if (!this.baseUrl) {
      return { status: 'degraded', detail: 'baseUrl 未設定 — 接続先サービス未稼働' };
    }
    try {
      const res = await timedFetch(`${this.baseUrl}${this.healthPath}`, {
        headers: this.headers,
      });
      if (res.ok) return { status: 'up' };
      return { status: 'degraded', detail: `health ${res.status}` };
    } catch (e) {
      return { status: 'down', detail: (e as Error).message };
    }
  }

  async fetch(path: string, init?: RequestInit): Promise<Response> {
    if (!this.baseUrl) {
      return new Response(
        JSON.stringify({ error: 'connector_unconfigured', connector: this.id }),
        { status: 503, headers: { 'content-type': 'application/json' } },
      );
    }
    const url = `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
    const mergedHeaders = { ...this.headers, ...(init?.headers ?? {}) };
    return timedFetch(url, { ...init, headers: mergedHeaders });
  }
}

/** Corpus 自身を表すコネクタ。 常に up。 */
export class SelfConnector implements ServiceConnector {
  readonly id = 'corpus';
  readonly title = 'Corpus';
  readonly scope: ConnectorScope = 'local';
  readonly baseUrl = '';

  async health(): Promise<ConnectorHealth> {
    return { status: 'up' };
  }

  async fetch(): Promise<Response> {
    return new Response(JSON.stringify({ service: 'corpus' }), {
      headers: { 'content-type': 'application/json' },
    });
  }
}
