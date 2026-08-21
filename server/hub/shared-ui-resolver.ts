// 共通 UI キー → UI 片 の引き先を hub のコネクタ群に結びつける。
//
// レジストリ (どこにあるか) と展開 (どう畳むか) を繋ぐだけの薄い層。
// 実 HTTP を触るのはここに閉じ、 shared-ui-expand.ts は純関数のままにする。

import type { HubRegistry } from './registry.ts';
import { buildSharedUiRegistry } from './shared-ui-registry.ts';
import type { SharedUiFragment, SharedUiResolver } from './shared-ui-expand.ts';

/**
 * レジストリを毎回組み直す resolver を返す。
 *
 * マニフェストは discovery で入れ替わるので、 起動時に固めず参照のたびに
 * 現在のコネクタ群から引く。 コネクタ数は多くないので走査コストは無視できる。
 */
export function makeSharedUiResolver(registry: HubRegistry): SharedUiResolver {
  return async (key: string): Promise<SharedUiFragment | null> => {
    const source = buildSharedUiRegistry(registry.listConnectors()).get(key);
    if (!source) return null;
    const conn = registry.getConnector(source.serviceId);
    if (!conn) return null;
    const res = await conn.fetch(source.endpoint);
    if (!res.ok) return null;
    const json = (await res.json()) as unknown;
    if (!json || typeof json !== 'object') return null;
    const o = json as Record<string, unknown>;
    if (!Array.isArray(o.components)) return null;
    return {
      ...(typeof o.title === 'string' ? { title: o.title } : {}),
      components: o.components as SharedUiFragment['components'],
    };
  };
}
