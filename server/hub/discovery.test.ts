import { describe, it, expect, afterEach } from 'vitest';
import { readDiscoveryConfig } from './discovery.ts';

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
