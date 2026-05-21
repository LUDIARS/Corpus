// D1 — ローカルサービス発見 + サーバ参照先設定 (VantanHub-DESIGN.md §9)。
//
//  - local モード: 既知 loopback port を probe し、 マニフェスト
//    (/.well-known/corpus-service.json) を持つサービスを発見する。
//  - server モード: 設定された参照先 baseUrl リストを使う。
//
// どちらも見つけたサービスを ManifestConnector としてレジストリに登録する。
// 起動後も定期的に再 probe し、 後から起動したサービスを拾う。

import { ManifestConnector } from '../connectors/manifest-connector.ts';
import type { HubRegistry } from './registry.ts';

export type CorpusMode = 'local' | 'server';

export interface DiscoveryConfig {
  mode: CorpusMode;
  /** local モードで probe する loopback ポート群。 */
  localPorts: number[];
  /** server モードで参照する baseUrl 群。 */
  serverServices: string[];
  /**
   * ローカルアプリがマルチ情報を取りに行くサーバサイド Corpus の URL。
   * local モードのとき、 ローカル直結に加えてこの remote を multi コネクタ
   * として登録する (DESIGN §3 「ローカル直結 + マルチはサーバ経由」)。
   */
  remoteUrl: string | null;
}

/** env から discovery 設定を読む。 */
export function readDiscoveryConfig(): DiscoveryConfig {
  const mode: CorpusMode =
    process.env.CORPUS_MODE === 'local' ? 'local' : 'server';
  const localPorts = (process.env.CORPUS_LOCAL_PROBE_PORTS ?? '5180,8888')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  const serverServices = (process.env.CORPUS_SERVER_SERVICES ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  const remoteUrl =
    process.env.CORPUS_REMOTE_URL?.trim().replace(/\/+$/, '') || null;
  return { mode, localPorts, serverServices, remoteUrl };
}

interface ProbeTarget {
  baseUrl: string;
  scope: 'local' | 'multi';
}

function targetsFor(cfg: DiscoveryConfig): ProbeTarget[] {
  if (cfg.mode === 'local') {
    const local: ProbeTarget[] = cfg.localPorts.map((p) => ({
      baseUrl: `http://localhost:${p}`,
      scope: 'local' as const,
    }));
    // ローカル直結に加え、 設定があればサーバサイド Corpus を multi で参照
    if (cfg.remoteUrl) {
      local.push({ baseUrl: cfg.remoteUrl, scope: 'multi' as const });
    }
    return local;
  }
  return cfg.serverServices.map((u) => ({
    baseUrl: u,
    scope: 'multi' as const,
  }));
}

/** 1 回 discovery を走らせる。 マニフェストを返したサービスを登録/更新する。 */
export async function runDiscovery(
  registry: HubRegistry,
  cfg: DiscoveryConfig,
): Promise<void> {
  const targets = targetsFor(cfg);
  await Promise.all(
    targets.map(async (t) => {
      const existing = registry.getDiscoveredByBaseUrl(t.baseUrl);
      if (existing) {
        // 既知サービスはマニフェストを再取得するだけ
        await existing.refresh();
        return;
      }
      const conn = new ManifestConnector({ baseUrl: t.baseUrl, scope: t.scope });
      if (await conn.init()) {
        registry.upsertDiscovered(conn);
        console.log(`[discovery] found: ${conn.id} @ ${t.baseUrl} (${t.scope})`);
      }
    }),
  );
}

/** 起動時 + 定期的に discovery を回す。 */
export function startDiscoveryLoop(
  registry: HubRegistry,
  cfg: DiscoveryConfig,
  intervalMs = 60_000,
): void {
  void runDiscovery(registry, cfg);
  const timer = setInterval(() => void runDiscovery(registry, cfg), intervalMs);
  timer.unref?.();
}
