// D1 — ローカルサービス発見 + サーバ参照先設定 (VantanHub-DESIGN.md §9)。
//
//  - local モード: 既知 loopback port を probe し、 マニフェスト
//    (/.well-known/corpus-service.json) を持つサービスを発見する。
//  - server モード: 設定された参照先 baseUrl リストを使う。
//
// どちらも見つけたサービスを ManifestConnector としてレジストリに登録する。
// 起動後も定期的に再 probe し、 後から起動したサービスを拾う。
//
// **起動後 (runtime) でも設定を差し替えられる** よう、 startDiscoveryLoop は
// DiscoveryController を返す (spec/feature/runtime-discovery.md)。 controller
// 経由で setConfig すれば新しいタイマで再開し、 旧 baseUrl にあった discovered
// connectors は registry から prune される。 VantanHub 等の継承先は起動時に
// `locked: true` で固定化できる。

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

/**
 * local モードの discovery 既定 probe port 一覧。 LUDIARS の
 * `infra/PORT-MAP.md` (`reference_ludiars_port_map`) に従う:
 *   - 8888  Actio backend (shared infra)
 *   - 17330 Concordia backend (loopback only)
 *   - 17332 Excubitor backend (loopback only、 運用コア。 /.well-known/corpus-service.json を公開)
 *   - 17370 Susurrus core (loopback only)
 *   - 17400 Quaestor backend (loopback only)
 *   - 17501 Bibliotheca (loopback only)
 *   - 17502 Aedilis (loopback only、 PORT-MAP 未掲載だが Aedilis spec 既定)
 *   - 17777 Custos
 *   - 5180  Memoria dev (legacy 既定)
 *
 * 不在 port は probe で接続拒否されて静かに skip されるので増やしても安全。
 * 新サービスを足すときはここに 1 行追加 + PORT-MAP を更新する。 `env`
 * `CORPUS_LOCAL_PROBE_PORTS` で完全上書き可。
 */
const DEFAULT_LOCAL_PROBE_PORTS =
  '5180,8888,17330,17332,17370,17400,17501,17502,17777';

/** env から discovery 設定を読む。 */
export function readDiscoveryConfig(): DiscoveryConfig {
  const mode: CorpusMode =
    process.env.CORPUS_MODE === 'local' ? 'local' : 'server';
  const localPorts = (process.env.CORPUS_LOCAL_PROBE_PORTS ?? DEFAULT_LOCAL_PROBE_PORTS)
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

/**
 * API から受け取った任意 JSON を DiscoveryConfig に整形する。 invalid なら
 * Error を throw (route 側で 400 にする)。 「local モードで何も探さない」
 * 「server モードで参照先ゼロ」 は事実上 disable と等価で意図と区別できない
 * ため明示エラーにする。
 */
export function normalizeDiscoveryConfig(input: unknown): DiscoveryConfig {
  if (!input || typeof input !== 'object') {
    throw new Error('discovery config must be an object');
  }
  const raw = input as Record<string, unknown>;
  const mode: CorpusMode = raw.mode === 'local' ? 'local' : 'server';
  const localPorts = Array.isArray(raw.localPorts)
    ? (raw.localPorts as unknown[])
        .map((n) => (typeof n === 'string' ? Number(n) : (n as number)))
        .filter((n): n is number => Number.isFinite(n) && n > 0 && n < 65536)
    : [];
  const serverServices = Array.isArray(raw.serverServices)
    ? (raw.serverServices as unknown[])
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim().replace(/\/+$/, ''))
        .filter(Boolean)
    : [];
  const remoteUrl =
    typeof raw.remoteUrl === 'string' && raw.remoteUrl.trim()
      ? raw.remoteUrl.trim().replace(/\/+$/, '')
      : null;
  if (mode === 'local' && localPorts.length === 0 && !remoteUrl) {
    throw new Error('local mode requires at least one localPorts entry or a remoteUrl');
  }
  if (mode === 'server' && serverServices.length === 0) {
    throw new Error('server mode requires at least one serverServices entry');
  }
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

/**
 * 起動後 (runtime) でも discovery 設定を差し替えるための制御口。
 *
 *  - `getConfig()` で現状を返す
 *  - `setConfig(next)` で:
 *      1. 走行中のタイマを止める
 *      2. registry から「新 target に含まれない」 discovered コネクタを prune
 *      3. 新 config で即時 discovery を 1 回走らせる
 *      4. タイマを再開する
 *  - `locked` (boot 時 only): true なら setConfig は throw する。
 *     継承先 (VantanHub 等) が「ハブは絶対固定」 にしたい場合に使う。
 *  - `stop()` でクリーンアップ (テスト + shutdown 用)。
 */
export interface DiscoveryController {
  getConfig(): DiscoveryConfig;
  /** boot 時に locked: true なら true。 setConfig は 423 に落ちる。 */
  isLocked(): boolean;
  /** 設定差し替え + 再 discovery。 locked のときは throw。 */
  setConfig(next: DiscoveryConfig): Promise<void>;
  /** 一度だけ discovery を走らせる (mount-time の即時 probe と同じ)。 */
  runOnce(): Promise<void>;
  /** タイマ停止 (テスト + shutdown)。 */
  stop(): void;
}

export interface StartDiscoveryOptions {
  /** 再 probe 周期 (ms)。 既定 60s。 */
  intervalMs?: number;
  /**
   * true で boot 時に lock。 runtime mutation API (`PUT /api/hub/discovery`)
   * は 423 Locked を返す。 継承先 (VantanHub 等) が「ハブは絶対固定」 にしたい
   * 場合の安全弁。 既定 false。
   */
  locked?: boolean;
}

/** 起動時 + 定期的に discovery を回す。 controller を返す。 */
export function startDiscoveryLoop(
  registry: HubRegistry,
  initialCfg: DiscoveryConfig,
  options: StartDiscoveryOptions = {},
): DiscoveryController {
  const intervalMs = options.intervalMs ?? 60_000;
  const locked = options.locked ?? false;
  let currentCfg: DiscoveryConfig = initialCfg;
  let timer: ReturnType<typeof setInterval> | null = null;

  const startTimer = (): void => {
    if (timer) clearInterval(timer);
    timer = setInterval(() => void runDiscovery(registry, currentCfg), intervalMs);
    timer.unref?.();
  };

  // 初回 probe を即発火 + タイマ start
  void runDiscovery(registry, currentCfg);
  startTimer();

  return {
    getConfig: () => ({ ...currentCfg, localPorts: [...currentCfg.localPorts], serverServices: [...currentCfg.serverServices] }),
    isLocked: () => locked,
    runOnce: () => runDiscovery(registry, currentCfg),
    setConfig: async (next) => {
      if (locked) {
        throw new Error('discovery is locked (boot-time CORPUS_DISCOVERY_LOCKED=1)');
      }
      currentCfg = next;
      // 新 target に含まれない discovered コネクタを prune
      const newTargets = new Set(targetsFor(next).map((t) => t.baseUrl.replace(/\/+$/, '')));
      registry.pruneDiscoveredExcept(newTargets);
      // タイマ作り直し + 即 1 回 probe
      startTimer();
      await runDiscovery(registry, next);
    },
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
