// サービスマニフェスト (D6 — VantanHub-DESIGN.md §8)。
//
// 参照対象になるサービスは、 認証不要で
//   GET /.well-known/corpus-service.json
// を公開する。 Corpus はこれを読んで、 集約するデータエンドポイント / hub
// パネル / 認証方式を知る。 旧「Cernere レジストリ」 案は破棄され、 各サービス
// 自前公開に置き換わった。

/** マニフェストが宣言する集約データエンドポイント。 */
export interface ManifestDataEndpoint {
  id: string;
  /** サービス内のパス (例 '/api/loans/mine')。 */
  path: string;
  /** ローカルサービス由来か、 マルチ集約由来か。 */
  scope: 'local' | 'multi';
  title?: string;
}

/** script panel — サービスが panel.js を配信し mount() を実行する (D4 / 旧来)。 */
export interface ScriptPanel {
  id: string;
  kind?: 'script';
  title: string;
  /** panel スクリプトのパス (例 '/corpus-ui/loans.js')。 */
  entry: string;
  icon?: string;
}

/** declarative panel — UI を JSON descriptor で宣言し Corpus 内蔵レンダラが描く (§13)。 */
export interface DeclarativePanel {
  id: string;
  kind: 'declarative';
  title: string;
  /** UI descriptor のインライン宣言。 */
  ui?: unknown;
  /** descriptor を返すエンドポイントのパス (ui の代替)。 */
  uiEndpoint?: string;
  icon?: string;
}

/** マニフェストが宣言する hub UI パネル。 */
export type ManifestPanel = ScriptPanel | DeclarativePanel;

/**
 * 共通 UI 定義の公開宣言 (DESIGN §13.4-11)。
 *
 * 他サービスの descriptor から `{ "type": "ref", "key": ... }` で参照される
 * UI 片を、 所有サービスがキーと取得先の対で公開する。 実体の展開は
 * Corpus hub が行う (server/hub/shared-ui-expand.ts)。
 */
export interface ManifestSharedUi {
  /** 参照キー。 サービス跨ぎで一意にするため所有サービス名を接頭辞にする慣習 (例 'cernere-auth-settings')。 */
  key: string;
  /** descriptor 片を返すサービス内のパス (例 '/api/corpus/ui/auth-settings')。 */
  endpoint: string;
}

/** GET /.well-known/corpus-service.json のレスポンス。 */
export interface CorpusServiceManifest {
  service: string;
  displayName: string;
  version: string;
  /** 本規約のバージョン (現在 1)。 */
  corpusApi: number;
  /** health チェックのパス (既定 '/api/health')。 */
  health: string;
  data: ManifestDataEndpoint[];
  panels: ManifestPanel[];
  /** このサービスが所有し、 他サービスへ参照させる共通 UI 定義。 */
  sharedUi?: ManifestSharedUi[];
  /** 認証方式 — 'cernere-project-token' | 'none'。 */
  auth: string;
  /** Cernere の managed project key。 省略時は service を使う (D5 のトークン発行用)。 */
  cernereProjectKey?: string;
}

const FETCH_TIMEOUT_MS = 4000;
export const MANIFEST_PATH = '/.well-known/corpus-service.json';

/**
 * baseUrl からサービスマニフェストを取得する。 取得不可・不正なら null。
 * 接続先が落ちていても throw しない。
 */
export async function fetchManifest(
  baseUrl: string,
): Promise<CorpusServiceManifest | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}${MANIFEST_PATH}`, {
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as Partial<CorpusServiceManifest>;
    return normalizeManifest(raw);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 部分的・壊れたマニフェストを安全な形に正規化する。 必須欠落なら null。 */
export function normalizeManifest(
  raw: Partial<CorpusServiceManifest> | null | undefined,
): CorpusServiceManifest | null {
  if (!raw || typeof raw.service !== 'string' || !raw.service) return null;
  return {
    service: raw.service,
    displayName:
      typeof raw.displayName === 'string' ? raw.displayName : raw.service,
    version: typeof raw.version === 'string' ? raw.version : '0.0.0',
    corpusApi: typeof raw.corpusApi === 'number' ? raw.corpusApi : 1,
    health: typeof raw.health === 'string' ? raw.health : '/api/health',
    data: Array.isArray(raw.data)
      ? raw.data.filter(
          (d): d is ManifestDataEndpoint =>
            !!d && typeof d.id === 'string' && typeof d.path === 'string',
        )
      : [],
    panels: Array.isArray(raw.panels)
      ? (raw.panels as unknown[]).filter((p): p is ManifestPanel => {
          if (!p || typeof p !== 'object') return false;
          const o = p as Record<string, unknown>;
          if (typeof o.id !== 'string' || typeof o.title !== 'string') return false;
          // declarative は ui / uiEndpoint、 script (既定) は entry を要求する
          return o.kind === 'declarative'
            ? o.ui != null || typeof o.uiEndpoint === 'string'
            : typeof o.entry === 'string';
        })
      : [],
    sharedUi: Array.isArray(raw.sharedUi)
      ? (raw.sharedUi as unknown[]).filter(
          (u): u is ManifestSharedUi =>
            !!u &&
            typeof u === 'object' &&
            typeof (u as Record<string, unknown>).key === 'string' &&
            !!(u as Record<string, unknown>).key &&
            typeof (u as Record<string, unknown>).endpoint === 'string' &&
            !!(u as Record<string, unknown>).endpoint,
        )
      : [],
    auth: typeof raw.auth === 'string' ? raw.auth : 'none',
    cernereProjectKey:
      typeof raw.cernereProjectKey === 'string'
        ? raw.cernereProjectKey
        : raw.service,
  };
}
