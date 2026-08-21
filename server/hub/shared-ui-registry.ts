// 共通 UI 定義のレジストリ (Corpus DESIGN.md §13.4-11)。
//
// 各サービスがマニフェストの `sharedUi[]` で「このキーの UI 片はうちが持つ」 と
// 宣言する。 hub はそれを 1 枚の key → 所有サービス の表に畳み、 descriptor 中の
// `{ "type": "ref", "key": ... }` を実体へ展開するときの引き先にする。
//
// 展開そのものは shared-ui-expand.ts。 ここは「どこに取りに行くか」 だけを持つ。

import type { ServiceConnector } from './types.ts';

/** 1 つの共通 UI キーの所在。 */
export interface SharedUiSource {
  serviceId: string;
  /** 所有サービス内のパス。 connector.fetch() にそのまま渡せる形。 */
  endpoint: string;
}

export type SharedUiRegistry = ReadonlyMap<string, SharedUiSource>;

/**
 * コネクタ群のマニフェストから共通 UI レジストリを組む。
 *
 * 同じキーを 2 つのサービスが宣言した場合は**先勝ち**にし、 後続は無視して警告する。
 * 認証のような単一正本を前提にした共通 UI で、 起動順に依存して実体が入れ替わると
 * 事故になるため、 黙って上書きしない。
 */
export function buildSharedUiRegistry(
  connectors: readonly ServiceConnector[],
): SharedUiRegistry {
  const map = new Map<string, SharedUiSource>();
  for (const conn of connectors) {
    const manifest = conn.getManifest?.();
    if (!manifest?.sharedUi) continue;
    for (const entry of manifest.sharedUi) {
      const existing = map.get(entry.key);
      if (existing) {
        if (existing.serviceId !== conn.id) {
          console.warn(
            `[hub] 共通 UI キー '${entry.key}' が重複宣言されている ` +
              `(採用: ${existing.serviceId} / 無視: ${conn.id})`,
          );
        }
        continue;
      }
      map.set(entry.key, { serviceId: conn.id, endpoint: entry.endpoint });
    }
  }
  return map;
}
