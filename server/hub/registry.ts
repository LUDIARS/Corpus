// hub レジストリ + プラグインパックローダ。
//
// 起動シーケンス (index.ts):
//   1. new HubRegistry(db)
//   2. 組み込みコネクタを addConnector
//   3. await registry.loadPluginPacks(CORPUS_PLUGIN_DIR)
//   4. registry.mountRoutes(app)  ← モジュールが registerRoute した分を mount
//
// プラグインモジュールは `<CORPUS_PLUGIN_DIR>/<id>/index.ts` から CorpusModule を
// default export する。 Corpus は tsx 実行なので .ts の動的 import がそのまま通る。

import type { Hono } from 'hono';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { CorpusDb } from '../db.ts';
import type {
  ConnectorInfo,
  CorpusContext,
  CorpusModule,
  Logger,
  ModuleInfo,
  PanelDescriptor,
  ServiceConnector,
} from './types.ts';

interface LoadedModule {
  module: CorpusModule;
  dir: string | null; // 組み込みモジュールは null
  panel: PanelDescriptor | null;
  routes: Hono[];
}

function makeLogger(tag: string): Logger {
  return {
    info: (m) => console.log(`[${tag}] ${m}`),
    warn: (m) => console.warn(`[${tag}] ${m}`),
    error: (m) => console.error(`[${tag}] ${m}`),
  };
}

export class HubRegistry {
  private readonly connectors = new Map<string, ServiceConnector>();
  private readonly loaded: LoadedModule[] = [];

  constructor(private readonly db: CorpusDb) {}

  /** 組み込みコネクタ (プラグイン外) を直接足す。 */
  addConnector(connector: ServiceConnector): void {
    if (this.connectors.has(connector.id)) {
      console.warn(`[hub] connector id 重複: ${connector.id} — 後勝ち`);
    }
    this.connectors.set(connector.id, connector);
  }

  listConnectors(): ServiceConnector[] {
    return [...this.connectors.values()];
  }

  getConnector(id: string): ServiceConnector | undefined {
    return this.connectors.get(id);
  }

  listModules(): ModuleInfo[] {
    return this.loaded.map((lm) => ({
      id: lm.module.id,
      title: lm.module.title,
      icon: lm.module.icon ?? null,
      panel: lm.panel ? { entry: lm.panel.entry ?? 'panel.js' } : null,
    }));
  }

  /** モジュールのディレクトリ (panel.js 静的配信用)。 */
  getModuleDir(moduleId: string): string | null {
    return this.loaded.find((lm) => lm.module.id === moduleId)?.dir ?? null;
  }

  /** registerRoute された Hono サブアプリを /api/x/<moduleId> に mount する。 */
  mountRoutes(app: Hono): void {
    for (const lm of this.loaded) {
      for (const sub of lm.routes) {
        app.route(`/api/x/${lm.module.id}`, sub);
      }
    }
  }

  connectorInfos(healths: Map<string, ConnectorInfo['health']>): ConnectorInfo[] {
    return this.listConnectors().map((c) => ({
      id: c.id,
      title: c.title,
      scope: c.scope,
      health: healths.get(c.id) ?? { status: 'down', detail: 'not checked' },
    }));
  }

  /**
   * CORPUS_PLUGIN_DIR を走査し、 配下の各サブディレクトリを 1 モジュールとして
   * ロードする。 pluginDir 未指定 / 不在なら何もしない。
   */
  async loadPluginPacks(pluginDir: string | undefined): Promise<void> {
    if (!pluginDir || !pluginDir.trim()) {
      console.log('[hub] CORPUS_PLUGIN_DIR 未設定 — 本体のみで起動');
      return;
    }
    const root = resolve(pluginDir.trim());
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      console.warn(`[hub] CORPUS_PLUGIN_DIR が不在: ${root}`);
      return;
    }

    const order = readPackOrder(root);
    for (const name of order) {
      const dir = join(root, name);
      const entry = ['index.ts', 'index.js', 'index.mjs']
        .map((f) => join(dir, f))
        .find((p) => existsSync(p));
      if (!entry) {
        console.warn(`[hub] モジュール ${name}: index.* が無い — skip`);
        continue;
      }
      try {
        const imported = (await import(pathToFileURL(entry).href)) as {
          default?: unknown;
        };
        const mod = imported.default;
        if (!isCorpusModule(mod)) {
          console.warn(`[hub] モジュール ${name}: default export が CorpusModule でない — skip`);
          continue;
        }
        if (mod.id !== name) {
          console.warn(`[hub] モジュール ${name}: module.id="${mod.id}" がディレクトリ名と不一致`);
        }
        await this.registerModule(mod, dir);
        console.log(`[hub] モジュールロード: ${mod.id} (${mod.title})`);
      } catch (e) {
        const msg = e instanceof Error ? e.stack ?? e.message : String(e);
        console.error(`[hub] モジュール ${name} ロード失敗: ${msg}`);
      }
    }
  }

  private async registerModule(
    module: CorpusModule,
    dir: string | null,
  ): Promise<void> {
    const entry: LoadedModule = { module, dir, panel: null, routes: [] };
    const ctx: CorpusContext = {
      db: this.db,
      moduleId: module.id,
      registerConnector: (c) => this.addConnector(c),
      registerRoute: (sub) => entry.routes.push(sub),
      registerPanel: (p) => {
        entry.panel = { ...p, moduleId: module.id, entry: p.entry ?? 'panel.js' };
      },
      env: (key) => process.env[key],
      logger: makeLogger(`mod:${module.id}`),
    };
    await module.setup(ctx);
    this.loaded.push(entry);
  }
}

function isCorpusModule(x: unknown): x is CorpusModule {
  if (typeof x !== 'object' || x === null) return false;
  const m = x as Record<string, unknown>;
  return (
    typeof m.id === 'string' &&
    typeof m.title === 'string' &&
    typeof m.setup === 'function'
  );
}

/**
 * pack.json があれば modules 配列の順でロード、 無ければサブディレクトリを
 * 名前順でロードする。
 */
function readPackOrder(root: string): string[] {
  const packJson = join(root, 'pack.json');
  if (existsSync(packJson)) {
    try {
      const parsed = JSON.parse(readFileSync(packJson, 'utf8')) as {
        modules?: unknown;
      };
      if (Array.isArray(parsed.modules)) {
        return parsed.modules.filter((m): m is string => typeof m === 'string');
      }
    } catch (e) {
      console.warn(`[hub] pack.json パース失敗: ${(e as Error).message}`);
    }
  }
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}
