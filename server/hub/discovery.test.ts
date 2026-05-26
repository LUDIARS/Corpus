import { describe, it, expect, afterEach } from 'vitest';
import {
  normalizeDiscoveryConfig,
  readDiscoveryConfig,
  startDiscoveryLoop,
  type DiscoveryConfig,
} from './discovery.ts';
import type { ManifestConnector } from '../connectors/manifest-connector.ts';
import type { HubRegistry } from './registry.ts';

const KEYS = [
  'CORPUS_MODE',
  'CORPUS_LOCAL_PROBE_PORTS',
  'CORPUS_SERVER_SERVICES',
  'CORPUS_REMOTE_URL',
];

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

describe('readDiscoveryConfig', () => {
  it('既定は server モード / remote なし', () => {
    const cfg = readDiscoveryConfig();
    expect(cfg.mode).toBe('server');
    expect(cfg.remoteUrl).toBeNull();
  });

  it('local モード + probe ポート + remote を読む', () => {
    process.env.CORPUS_MODE = 'local';
    process.env.CORPUS_LOCAL_PROBE_PORTS = '5180, 8888';
    process.env.CORPUS_REMOTE_URL = 'https://hub.example.com/';
    const cfg = readDiscoveryConfig();
    expect(cfg.mode).toBe('local');
    expect(cfg.localPorts).toEqual([5180, 8888]);
    // 末尾スラッシュは除去される
    expect(cfg.remoteUrl).toBe('https://hub.example.com');
  });

  it('local モードで env 未指定なら LUDIARS PORT-MAP の主要 port が既定', () => {
    process.env.CORPUS_MODE = 'local';
    const cfg = readDiscoveryConfig();
    expect(cfg.mode).toBe('local');
    // Bibliotheca / Aedilis / Concordia / Susurrus / Quaestor / Actio / Memoria / Custos
    // が含まれること。 不在 port は probe 段階で接続拒否されて skip されるので
    // 既定リストを広めに持つ。
    expect(cfg.localPorts).toContain(5180);   // Memoria
    expect(cfg.localPorts).toContain(8888);   // Actio
    expect(cfg.localPorts).toContain(17330);  // Concordia
    expect(cfg.localPorts).toContain(17370);  // Susurrus
    expect(cfg.localPorts).toContain(17400);  // Quaestor
    expect(cfg.localPorts).toContain(17501);  // Bibliotheca
    expect(cfg.localPorts).toContain(17502);  // Aedilis
    expect(cfg.localPorts).toContain(17777);  // Custos
  });

  it('server モードの参照先リストを読む (末尾スラッシュ除去)', () => {
    process.env.CORPUS_SERVER_SERVICES = 'https://a.example.com, https://b.example.com/';
    const cfg = readDiscoveryConfig();
    expect(cfg.serverServices).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });
});

// ────────────────────────────────────────────────────────────────────────
// runtime mutation (DiscoveryController) — spec/feature: 起動後 discovery 変更
// ────────────────────────────────────────────────────────────────────────

/**
 * テスト用に最小限の HubRegistry。 discovery が触る面 (upsertDiscovered /
 * getDiscoveredByBaseUrl / pruneDiscoveredExcept) だけ実装する。 本物の
 * HubRegistry は db を要求するので、 controller の挙動だけ確かめたい場合は
 * このスタブで十分。
 */
function makeStubRegistry(): {
  registry: HubRegistry;
  discovered: Map<string, ManifestConnector>;
  pruneCalls: ReadonlySet<string>[];
} {
  const discovered = new Map<string, ManifestConnector>();
  const pruneCalls: ReadonlySet<string>[] = [];
  const registry = {
    upsertDiscovered(conn: ManifestConnector) {
      discovered.set(conn.baseUrl.replace(/\/+$/, ''), conn);
    },
    getDiscoveredByBaseUrl(baseUrl: string) {
      return discovered.get(baseUrl.replace(/\/+$/, ''));
    },
    pruneDiscoveredExcept(keep: ReadonlySet<string>) {
      pruneCalls.push(keep);
      const removed: string[] = [];
      for (const [u, conn] of discovered.entries()) {
        if (!keep.has(u)) {
          removed.push(conn.id);
          discovered.delete(u);
        }
      }
      return removed;
    },
    // discovery のループは fetch を使うが、 テストでは初回 probe を確認
    // しない (interval も大きく取って fire しない)。 他メソッドは触られない。
  } as unknown as HubRegistry;
  return { registry, discovered, pruneCalls };
}

const SERVER_CFG: DiscoveryConfig = {
  mode: 'server',
  localPorts: [],
  serverServices: ['http://a.example.com', 'http://b.example.com'],
  remoteUrl: null,
};
const LOCAL_CFG: DiscoveryConfig = {
  mode: 'local',
  localPorts: [5180, 8888],
  serverServices: [],
  remoteUrl: null,
};

describe('startDiscoveryLoop (runtime mutation)', () => {
  it('controller.getConfig は initial を返す + isLocked=false が既定', () => {
    const { registry } = makeStubRegistry();
    const ctrl = startDiscoveryLoop(registry, SERVER_CFG, { intervalMs: 60_000_000 });
    try {
      const got = ctrl.getConfig();
      expect(got.mode).toBe('server');
      expect(got.serverServices).toEqual(SERVER_CFG.serverServices);
      // 返り値はディープコピー (caller の mutation で内部が壊れない)
      got.serverServices.push('mutated');
      expect(ctrl.getConfig().serverServices).toEqual(SERVER_CFG.serverServices);
      expect(ctrl.isLocked()).toBe(false);
    } finally {
      ctrl.stop();
    }
  });

  it('setConfig は新 config を適用 + 新 target に無い discovered を prune', async () => {
    const { registry, discovered, pruneCalls } = makeStubRegistry();
    // 初期は SERVER mode で a, b を discovered として登録しておく。 stub には
    // refresh = no-op を生やしておく (初回 probe で `existing.refresh()` が
    // 呼ばれるため)。
    const stubConn = (id: string, baseUrl: string): ManifestConnector =>
      ({ id, baseUrl, refresh: async () => {} } as unknown as ManifestConnector);
    discovered.set('http://a.example.com', stubConn('a', 'http://a.example.com'));
    discovered.set('http://b.example.com', stubConn('b', 'http://b.example.com'));
    const ctrl = startDiscoveryLoop(registry, SERVER_CFG, { intervalMs: 60_000_000 });
    try {
      // local モードに切り替え → server 側 a, b は prune されるはず
      await ctrl.setConfig(LOCAL_CFG);
      expect(ctrl.getConfig().mode).toBe('local');
      // prune 呼び出しがあり、 新 target (http://localhost:5180 / 8888) のみが残る
      expect(pruneCalls.length).toBeGreaterThanOrEqual(1);
      const lastKeep = pruneCalls[pruneCalls.length - 1]!;
      expect(lastKeep.has('http://localhost:5180')).toBe(true);
      expect(lastKeep.has('http://localhost:8888')).toBe(true);
      expect(lastKeep.has('http://a.example.com')).toBe(false);
      // a, b は discovered から落ちている
      expect(discovered.has('http://a.example.com')).toBe(false);
      expect(discovered.has('http://b.example.com')).toBe(false);
    } finally {
      ctrl.stop();
    }
  });

  it('locked: true なら setConfig は throw + getConfig は変わらない', async () => {
    const { registry } = makeStubRegistry();
    const ctrl = startDiscoveryLoop(registry, SERVER_CFG, { intervalMs: 60_000_000, locked: true });
    try {
      expect(ctrl.isLocked()).toBe(true);
      await expect(ctrl.setConfig(LOCAL_CFG)).rejects.toThrow(/locked/);
      expect(ctrl.getConfig().mode).toBe('server');
    } finally {
      ctrl.stop();
    }
  });
});

describe('normalizeDiscoveryConfig', () => {
  it('server モードで services を受ける', () => {
    const cfg = normalizeDiscoveryConfig({
      mode: 'server',
      serverServices: ['https://a.example.com/', 'https://b.example.com'],
    });
    expect(cfg.mode).toBe('server');
    expect(cfg.serverServices).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it('local モードで localPorts + remoteUrl を受ける', () => {
    const cfg = normalizeDiscoveryConfig({
      mode: 'local',
      localPorts: [5180, '8888'],
      remoteUrl: 'https://hub.example.com/',
    });
    expect(cfg.mode).toBe('local');
    expect(cfg.localPorts).toEqual([5180, 8888]);
    expect(cfg.remoteUrl).toBe('https://hub.example.com');
  });

  it('local モードで何も探さない設定は invalid', () => {
    expect(() => normalizeDiscoveryConfig({ mode: 'local' })).toThrow(/at least one/);
  });

  it('server モードで services 空も invalid', () => {
    expect(() => normalizeDiscoveryConfig({ mode: 'server' })).toThrow(/at least one/);
  });

  it('object でないと invalid', () => {
    expect(() => normalizeDiscoveryConfig(null)).toThrow();
    expect(() => normalizeDiscoveryConfig('foo')).toThrow();
  });
});
