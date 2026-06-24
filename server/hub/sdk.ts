// プラグインパック向け SDK。
//
// プラグインモジュール (VantanHub 等) は、 ランタイム依存をすべてこのファイル
// 経由で import すること。 直接 `hono` を import すると node の解決規則上
// プラグイン側 node_modules の別コピーを掴み、 hono が二重ロードされて
// app.route() が壊れる。 sdk.ts を経由すれば Corpus 側の単一コピーを共有できる。
//
// 使い方 (プラグインの index.ts):
//   import { Hono, HttpServiceConnector } from '<corpus>/server/hub/sdk.ts';
//   import type { CorpusModule, CorpusContext } from '<corpus>/server/hub/sdk.ts';

export { Hono } from 'hono';
export type { Context, MiddlewareHandler } from 'hono';

export { HttpServiceConnector, SelfConnector } from '../connectors/builtin.ts';
export type { HttpConnectorOptions } from '../connectors/builtin.ts';

// 認証 — プラグインのルートは /api/x/<id> に mount され requireAuth 配下なので、
// ハンドラ内で getIdentity(c) / getUserToken(c) を使ってよい。 getUserToken は
// requireAuth が検証済みで積んだ user accessToken を返す (参照先トークン発行用)。
export { getIdentity, getUserToken, requireAuth, requireAdmin } from '../auth.ts';
export type { AuthIdentity } from '../auth.ts';

// 参照先トークン伝播 (D5) — plugin proxy が leaf を叩く前に、 受信ユーザトークンを
// 参照先プロジェクト用トークンへ解決するために CorpusContext.tokenProvider を使う。
// /api/hub/data と同じ TokenProvider インスタンス経由 (経路ごとに別実装にしない)。
export type { TokenProvider, DownstreamTarget } from './tokens.ts';

export type { CorpusDb } from '../db.ts';
export { cacheDisplayName, getDisplayName } from '../db.ts';

export type {
  CorpusModule,
  CorpusContext,
  ServiceConnector,
  ConnectorHealth,
  ConnectorScope,
  HealthStatus,
  PanelDescriptor,
  Logger,
} from './types.ts';
