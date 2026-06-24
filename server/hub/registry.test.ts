import { describe, it, expect } from 'vitest';
import { openDb } from '../db.ts';
import { HubRegistry } from './registry.ts';
import { PassthroughTokenProvider } from './tokens.ts';
import type { ConnectorHealth, ServiceConnector } from './types.ts';

function fakeConnector(
  id: string,
  scope: 'local' | 'multi' = 'multi',
): ServiceConnector {
  return {
    id,
    title: id,
    scope,
    baseUrl: '',
    health: async (): Promise<ConnectorHealth> => ({ status: 'up' }),
    fetch: async () => new Response('{}'),
  };
}

describe('HubRegistry', () => {
  it('コネクタを追加・列挙・取得できる', () => {
    const reg = new HubRegistry(openDb(':memory:'));
    reg.addConnector(fakeConnector('a'));
    reg.addConnector(fakeConnector('b', 'local'));
    expect(
      reg
        .listConnectors()
        .map((c) => c.id)
        .sort(),
    ).toEqual(['a', 'b']);
    expect(reg.getConnector('a')?.id).toBe('a');
    expect(reg.getConnector('missing')).toBeUndefined();
  });

  it('プラグイン未ロードなら ownManifest / listModules は空', () => {
    const reg = new HubRegistry(openDb(':memory:'));
    expect(reg.ownManifest().data).toEqual([]);
    expect(reg.listModules()).toEqual([]);
  });

  it('CORPUS_PLUGIN_DIR 未指定なら loadPluginPacks は no-op', async () => {
    const reg = new HubRegistry(openDb(':memory:'));
    await reg.loadPluginPacks(undefined, new PassthroughTokenProvider());
    expect(reg.listModules()).toEqual([]);
  });
});
