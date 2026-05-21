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
