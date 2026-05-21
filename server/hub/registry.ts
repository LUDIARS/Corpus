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
import type { ManifestConnector } from '../connectors/manifest-connector.ts';
import type { ManifestDataEndpoint, ManifestPanel } from './manifest.ts';
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
  /** registerData で宣言された hub データエンドポイント (path は絶対化済)。 */
  manifestData: ManifestDataEndpoint[];
  /** setup 中に registerConnector された分。 setup 成功後にまとめて commit する。 */
  connectors: ServiceConnector[];
}

function makeLogger(tag: string): Logger {
  return {
    info: (m) => console.log(`[${tag}] ${m}`),
    warn: (m) => console.warn(`[${tag}] ${m}`),
    error: (m) => console.error(`[${tag}] ${m}`),
  };
}

export class HubRegistry {
  // プラグイン / 組み込みが手動登録するコネクタ (id キー)
  private readonly connectors = new Map<string, ServiceConnector>();
  // discovery が見つけたマニフェスト駆動コネクタ (baseUrl キー)
  private readonly discovered = new Map<string, ManifestConnector>();
  private readonly loaded: LoadedModule[] = [];

  constructor(private readonly db: CorpusDb) {}

  /** 組み込みコネクタ (プラグイン外) を直接足す。 */
  addConnector(connector: ServiceConnector): void {
    if (this.connectors.has(connector.id)) {
      console.warn(`[hub] connector id 重複: ${connector.id} — 後勝ち`);
    }
    this.connectors.set(connector.id, connector);
  }

  /** discovery が見つけたコネクタを登録/更新する (baseUrl 単位)。 */
  upsertDiscovered(connector: ManifestConnector): void {
    this.discovered.set(connector.baseUrl, connector);
  }

  getDiscoveredByBaseUrl(baseUrl: string): ManifestConnector | undefined {
    return this.discovered.get(baseUrl.replace(/\/+$/, ''));
  }

  /** 手動登録 + discovery のコネクタを全部返す。 */
  listConnectors(): ServiceConnector[] {
    return [...this.connectors.values(), ...this.discovered.values()];
  }

  getConnector(id: string): ServiceConnector | undefined {
    return (
      this.connectors.get(id) ??
      [...this.discovered.values()].find((c) => c.id === id)
    );
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
    const entry: LoadedModule = {
      module,
      dir,
      panel: null,
      routes: [],
      manifestData: [],
      connectors: [],
    };
    const ctx: CorpusContext = {
      db: this.db,
      moduleId: module.id,
      // setup 失敗時にコネクタが半端に残らないよう、 一旦 entry に溜めて
      // setup 成功後にまとめて commit する (部分登録リーク対策)。
      registerConnector: (c) => entry.connectors.push(c),
      registerRoute: (sub) => entry.routes.push(sub),
      registerPanel: (p) => {
        entry.panel = { ...p, moduleId: module.id, entry: p.entry ?? 'panel.js' };
      },
      registerData: (d) => {
        // path をモジュールの mount 先 (/api/x/<moduleId>) 基準で絶対化する
        const rel = d.path.startsWith('/') ? d.path : `/${d.path}`;
        entry.manifestData.push({
          id: d.id,
          path: `/api/x/${module.id}${rel}`,
          title: d.title ?? d.id,
          scope: d.scope ?? 'multi',
        });
      },
      env: (key) => process.env[key],
      logger: makeLogger(`mod:${module.id}`),
    };
    await module.setup(ctx);
    // setup がここまで throw せず到達したら、 登録物を一括 commit する。
    for (const conn of entry.connectors) this.addConnector(conn);
    this.loaded.push(entry);
  }

  /**
   * この Corpus 自身のサービスマニフェスト用の data[] / panels[]。
   * data はプラグインが registerData で宣言した分。 panels はプラグインの
   * 登録パネルで、 entry は参照先絶対パス /plugins/<id>/<file>。
   */
  ownManifest(): { data: ManifestDataEndpoint[]; panels: ManifestPanel[] } {
    const panels: ManifestPanel[] = [];
    for (const lm of this.loaded) {
      if (lm.panel) {
        panels.push({
          id: lm.module.id,
          title: lm.panel.title,
          icon: lm.panel.icon,
          entry: `/plugins/${lm.module.id}/${lm.panel.entry ?? 'panel.js'}`,
        });
      }
    }
    return {
      data: this.loaded.flatMap((lm) => lm.manifestData),
      panels,
    };
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
