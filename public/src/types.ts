// frontend 用の型 (server 側 hub/types.ts の表示用ミラー)。

export type ConnectorScope = 'local' | 'multi';
export type HealthStatus = 'up' | 'down' | 'degraded';

export interface ConnectorInfo {
  id: string;
  title: string;
  scope: ConnectorScope;
  health: { status: HealthStatus; detail?: string };
}

export interface ModuleInfo {
  id: string;
  title: string;
  icon: string | null;
  panel: { entry: string } | null;
}

export interface Identity {
  userId: string;
  /** Corpus が解決した owner 識別子 (external-id)。 */
  externalId: string;
  role: string;
  displayName: string | null;
  isAdmin: boolean;
}

export interface HubOverview {
  checkedAt: number;
  local: ConnectorInfo[];
  multi: ConnectorInfo[];
  counts: { up: number; degraded: number; down: number };
}

export interface ServiceDataInfo {
  id: string;
  title: string;
  scope: ConnectorScope;
}

export interface ServicePanelInfo {
  id: string;
  title: string;
  entry: string;
  icon?: string;
}

/** /api/hub/services の要素 — コネクタ + そのサービスマニフェスト。 */
export interface ServiceInfo {
  id: string;
  title: string;
  scope: ConnectorScope;
  manifest: {
    displayName: string;
    version: string;
    auth: string;
    data: ServiceDataInfo[];
    panels: ServicePanelInfo[];
  } | null;
}

/**
 * プラグインパネルの mount() に渡るコンテキスト。
 * panel.js は `export function mount(container, ctx) { ... }` を持つ。
 */
export interface PanelContext {
  /** このパネルのモジュール id。 */
  moduleId: string;
  /** 自分の identity。 */
  identity: Identity;
  /** モジュールの API (/api/x/<moduleId> 配下) を叩く。 認証ヘッダ付き。 */
  api(path: string, init?: RequestInit): Promise<Response>;
  /** Corpus 共通 API (/api/...) を叩く。 認証ヘッダ付き。 */
  hubApi(path: string, init?: RequestInit): Promise<Response>;
}

export interface PanelModule {
  mount(container: HTMLElement, ctx: PanelContext): void | Promise<void>;
}

/**
 * 参照サービス (Bb / Ae 等) が提供する Corpus 用 UI コンポーネントの
 * mount() に渡るコンテキスト (D4)。 サービスは Corpus を submodule で持たない
 * ため、 この型は各サービス側で同形のものを宣言してよい。
 */
export interface ServicePanelContext {
  /** このパネルを提供するサービス id。 */
  service: string;
  /** 自分の identity。 */
  identity: Identity;
  /**
   * サービスマニフェスト宣言済みの data エンドポイントを id で叩く。
   * 既定 GET。 init で method/body を渡せば POST 等の write-through も可。
   */
  data(dataId: string, init?: RequestInit): Promise<Response>;
}

export interface ServicePanelModule {
  mount(
    container: HTMLElement,
    ctx: ServicePanelContext,
  ): void | Promise<void>;
}
