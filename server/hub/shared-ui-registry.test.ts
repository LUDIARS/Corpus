// 共通 UI レジストリ (§13.4-11) — key → 所有サービス の畳み込み。

import { describe, expect, it, vi } from 'vitest';
import { buildSharedUiRegistry } from './shared-ui-registry.ts';
import type { CorpusServiceManifest, ManifestSharedUi } from './manifest.ts';
import type { ServiceConnector } from './types.ts';

function connector(id: string, sharedUi?: ManifestSharedUi[]): ServiceConnector {
  const manifest = {
    service: id,
    displayName: id,
    version: '1.0.0',
    corpusApi: 2,
    health: '/api/health',
    data: [],
    panels: [],
    sharedUi,
    auth: 'none',
  } as CorpusServiceManifest;
  return {
    id,
    title: id,
    scope: 'local',
    baseUrl: `http://${id}.test`,
    health: async () => ({ status: 'up' }),
    fetch: async () => new Response('{}'),
    getManifest: () => manifest,
  };
}

describe('buildSharedUiRegistry', () => {
  it('maps each declared key to its owning service', () => {
    const reg = buildSharedUiRegistry([
      connector('cernere', [
        { key: 'cernere-auth-settings', endpoint: '/api/corpus/ui/auth-settings' },
      ]),
      connector('aedilis'),
    ]);
    expect(reg.get('cernere-auth-settings')).toEqual({
      serviceId: 'cernere',
      endpoint: '/api/corpus/ui/auth-settings',
    });
    expect(reg.size).toBe(1);
  });

  it('keeps the first declaration when two services claim the same key', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reg = buildSharedUiRegistry([
      connector('cernere', [{ key: 'dup', endpoint: '/a' }]),
      connector('impostor', [{ key: 'dup', endpoint: '/b' }]),
    ]);
    // 起動順で実体が入れ替わると事故になるので、 黙って上書きしない
    expect(reg.get('dup')).toEqual({ serviceId: 'cernere', endpoint: '/a' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('ignores connectors without a manifest', () => {
    const plugin: ServiceConnector = {
      id: 'plugin',
      title: 'plugin',
      scope: 'local',
      baseUrl: '',
      health: async () => ({ status: 'up' }),
      fetch: async () => new Response('{}'),
    };
    expect(buildSharedUiRegistry([plugin]).size).toBe(0);
  });
});
