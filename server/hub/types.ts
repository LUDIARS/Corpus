// Corpus hub フレームワークの型定義。
//
// Corpus 本体はドメインを持たない。 ドメイン機能は CorpusModule (プラグインパック)
// として外から差し込み、 setup() の中で CorpusContext 経由でコネクタ / API ルート /
// hub パネルを登録する。

import type { Hono } from 'hono';
import type { CorpusDb } from '../db.ts';
import type { CorpusServiceManifest } from './manifest.ts';

/** 接続先サービスの種別。 frontend がローカル印 / マルチ印を出し分ける。 */
export type ConnectorScope = 'local' | 'multi';

export type HealthStatus = 'up' | 'down' | 'degraded';

export interface ConnectorHealth {
  status: HealthStatus;
  detail?: string;
}

/**
 * 1 つの LUDIARS サービスへの接続。
 * 「サービスの multi-hub backend を叩く HTTP クライアント」 に徹する。
 */
export interface ServiceConnector {
  id: string;
  title: string;
  scope: ConnectorScope;
  /** 到達性チェック。 接続先が落ちていても throw せず status:'down' を返すこと。 */
  health(): Promise<ConnectorHealth>;
  /** hub 表示用データの取得。 path は接続先サービスのエンドポイント相対パス。 */
  fetch(path: string, init?: RequestInit): Promise<Response>;
  /**
   * マニフェスト由来のコネクタ (ManifestConnector) はサービスマニフェストを返す。
   * プラグインが手動登録するコネクタ (HttpServiceConnector) は undefined。
   */
  getManifest?(): CorpusServiceManifest | null;
}

/**
 * hub frontend に出すタブ。 frontend shell は entry の JS を動的 import し、
 * その mount(container, ctx) を呼ぶ。
 */
export interface PanelDescriptor {
  /** 所属モジュール id (= タブ id)。 setup 内では省略可、 registry が補完する。 */
  moduleId?: string;
  title: string;
  icon?: string;
  /** モジュールディレクトリ相対のパネルスクリプト。 既定 'panel.js'。 */
  entry?: string;
}

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

/**
 * CorpusModule の setup() に渡る登録 API。
 */
/** モジュールが宣言する hub データエンドポイント (registerData の引数)。 */
export interface ModuleDataDecl {
  id: string;
  /** /api/x/<moduleId> 相対パス (例 '/board')。 */
  path: string;
  title?: string;
  scope?: ConnectorScope;
}

export interface CorpusContext {
  /** Corpus 本体と共有の SQLite。 モジュールは自分のテーブルを CREATE IF NOT EXISTS で足してよい。 */
  readonly db: CorpusDb;
  /** このモジュールの id。 */
  readonly moduleId: string;
  /** サービスコネクタを登録する。 */
  registerConnector(connector: ServiceConnector): void;
  /** Hono サブアプリを /api/x/<moduleId> に mount する。 */
  registerRoute(sub: Hono): void;
  /** hub frontend のタブを登録する。 */
  registerPanel(panel: PanelDescriptor): void;
  /**
   * hub データエンドポイントを宣言する。 Corpus 自身のマニフェスト
   * (/.well-known/corpus-service.json) の data[] に載り、 この Corpus を
   * 参照する上位 hub から集約できるようになる (D6)。
   */
  registerData(decl: ModuleDataDecl): void;
  /** env を読む。 */
  env(key: string): string | undefined;
  readonly logger: Logger;
}

/**
 * プラグインパックの 1 モジュール。 `<CORPUS_PLUGIN_DIR>/<id>/index.ts` から
 * default export する。
 */
export interface CorpusModule {
  id: string;
  title: string;
  icon?: string;
  setup(ctx: CorpusContext): void | Promise<void>;
}

/** /api/hub/modules のレスポンス要素。 */
export interface ModuleInfo {
  id: string;
  title: string;
  icon: string | null;
  panel: { entry: string } | null;
}

/** /api/hub/connectors のレスポンス要素。 */
export interface ConnectorInfo {
  id: string;
  title: string;
  scope: ConnectorScope;
  health: ConnectorHealth;
}
