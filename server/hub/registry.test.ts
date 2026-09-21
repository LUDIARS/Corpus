import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it, expect } from 'vitest';
import type { AuthIdentity } from '../auth.ts';
import { openDb } from '../db.ts';
import { CapabilityNotFoundError, HubRegistry } from './registry.ts';
import { PassthroughTokenProvider } from './tokens.ts';
import type { ConnectorHealth, ServiceConnector } from './types.ts';

const identity: AuthIdentity = {
  userId: 'user-1',
  externalId: 'employee-1',
  role: 'member',
  displayName: 'Test User',
  projectKey: null,
  isAdmin: false,
};

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

describe('HubRegistry capabilities', () => {
  const packs: string[] = [];

  afterEach(async () => {
    for (const dir of packs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  /** `<dir>/<moduleId>/index.mjs` を 1 モジュールとする最小プラグインパックを作る。 */
  async function writePack(moduleId: string, setupBody: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'corpus-pack-'));
    packs.push(root);
    await mkdir(join(root, moduleId), { recursive: true });
    await writeFile(
      join(root, moduleId, 'index.mjs'),
      `export default { id: ${JSON.stringify(moduleId)}, title: ${JSON.stringify(moduleId)},`
      + ` setup(ctx) { ${setupBody} } };\n`,
      'utf8',
    );
    return root;
  }

  const listCapability = `ctx.registerCapability({
    id: 'list_announcements',
    title: 'お知らせ一覧',
    description: '一覧を取得',
    inputSchema: { type: 'object', additionalProperties: false },
    readOnly: true,
    invoke: (input, context) => ({ input, userId: context.identity.userId }),
  });`;

  async function loadPack(moduleId: string, setupBody: string): Promise<HubRegistry> {
    const reg = new HubRegistry(openDb(':memory:'));
    await reg.loadPluginPacks(await writePack(moduleId, setupBody), new PassthroughTokenProvider());
    return reg;
  }

  it('登録した capability を module 込みの id で列挙する', async () => {
    const reg = await loadPack('announcements', listCapability);
    expect(reg.listCapabilities()).toEqual([{
      id: 'announcements.list_announcements',
      moduleId: 'announcements',
      capabilityId: 'list_announcements',
      title: 'お知らせ一覧',
      description: '一覧を取得',
      inputSchema: { type: 'object', additionalProperties: false },
      readOnly: true,
    }]);
  });

  it('invoke は呼び出し元 identity を handler へ渡す', async () => {
    const reg = await loadPack('announcements', listCapability);
    await expect(reg.invokeCapability(
      'announcements',
      'list_announcements',
      { limit: 3 },
      identity,
    )).resolves.toEqual({ input: { limit: 3 }, userId: 'user-1' });
  });

  it('未知の module / capability は CapabilityNotFoundError', async () => {
    const reg = await loadPack('announcements', listCapability);
    await expect(reg.invokeCapability('missing', 'list_announcements', {}, identity))
      .rejects.toBeInstanceOf(CapabilityNotFoundError);
    await expect(reg.invokeCapability('announcements', 'missing', {}, identity))
      .rejects.toBeInstanceOf(CapabilityNotFoundError);
  });

  it('id 規約違反と重複登録は setup を失敗させ、 module ごと登録しない', async () => {
    const invalidId = await loadPack(
      'announcements',
      "ctx.registerCapability({ id: 'List-Announcements', title: 't', description: 'd',"
      + " inputSchema: { type: 'object' }, readOnly: true, invoke: () => null });",
    );
    expect(invalidId.listModules()).toEqual([]);
    expect(invalidId.listCapabilities()).toEqual([]);

    const duplicated = await loadPack('announcements', `${listCapability}${listCapability}`);
    expect(duplicated.listModules()).toEqual([]);
    expect(duplicated.listCapabilities()).toEqual([]);
  });
});
