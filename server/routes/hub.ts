// /api/hub/* — hub frontend が叩く集約 API。

import { Hono } from 'hono';
import {
  type CorpusDb,
  listExternalIdMappings,
  reassignExternalId,
} from '../db.ts';
import { getUserToken, requireAdmin } from '../auth.ts';
import { buildOverview } from '../hub/aggregate.ts';
import type { HubRegistry } from '../hub/registry.ts';
import type { ConnectorInfo } from '../hub/types.ts';
import type { TokenProvider } from '../hub/tokens.ts';
import {
  type DiscoveryController,
  normalizeDiscoveryConfig,
} from '../hub/discovery.ts';

interface HealthRow {
  connector_id: string;
  status: string;
  detail: string | null;
  checked_at: number;
}

export interface HubRouterDeps {
  registry: HubRegistry;
  db: CorpusDb;
  tokenProvider: TokenProvider;
  /** runtime に discovery 設定を読む/差し替える窓口。 spec/feature/runtime-discovery.md */
  discoveryController: DiscoveryController;
}

export function makeHubRouter(deps: HubRouterDeps): Hono;
/**
 * @deprecated 4-引数の旧シグネチャは互換維持のため残す。 新規呼び出しは
 *  `{ registry, db, tokenProvider, discoveryController }` 形式の deps オブジェクト
 *  経由で。 旧形式は discovery API を持たない (routes が登録されない)。
 */
export function makeHubRouter(
  registry: HubRegistry,
  db: CorpusDb,
  tokenProvider: TokenProvider,
): Hono;
export function makeHubRouter(
  arg: HubRouterDeps | HubRegistry,
  dbArg?: CorpusDb,
  tokenProviderArg?: TokenProvider,
): Hono {
  const deps: HubRouterDeps =
    'registry' in arg
      ? arg
      : {
          registry: arg,
          db: dbArg!,
          tokenProvider: tokenProviderArg!,
          discoveryController: null as unknown as DiscoveryController,
        };
  const { registry, db, tokenProvider, discoveryController } = deps;
  const r = new Hono();

  // frontend shell がタブを描くためのモジュール一覧
  r.get('/modules', (c) => c.json({ modules: registry.listModules() }));

  // コネクタ一覧 + DB に保存済みの最新 health (フレッシュチェックはしない)
  r.get('/connectors', (c) => {
    const rows = db
      .prepare(`SELECT connector_id, status, detail, checked_at FROM connector_health`)
      .all() as HealthRow[];
    const healthById = new Map(rows.map((row) => [row.connector_id, row]));
    const connectors: ConnectorInfo[] = registry.listConnectors().map((conn) => {
      const row = healthById.get(conn.id);
      return {
        id: conn.id,
        title: conn.title,
        scope: conn.scope,
        health: row
          ? { status: row.status as ConnectorInfo['health']['status'], detail: row.detail ?? undefined }
          : { status: 'down', detail: 'not checked' },
      };
    });
    return c.json({ connectors });
  });

  // local/multi 区別つきの集約サマリ (フレッシュに health チェック)
  r.get('/overview', async (c) => {
    const overview = await buildOverview(registry, db);
    return c.json(overview);
  });

  // discovery / 手動登録の全サービスとそのマニフェスト (frontend が
  // データタブ・パネルを描くために使う)
  r.get('/services', (c) => {
    const services = registry.listConnectors().map((conn) => {
      const m = conn.getManifest?.() ?? null;
      return {
        id: conn.id,
        title: conn.title,
        scope: conn.scope,
        manifest: m
          ? {
              displayName: m.displayName,
              version: m.version,
              auth: m.auth,
              data: m.data.map((d) => ({
                id: d.id,
                title: d.title ?? d.id,
                scope: d.scope,
              })),
              panels: m.panels,
            }
          : null,
      };
    });
    return c.json({ services });
  });

  // データ集約 — マニフェスト宣言済みエンドポイントをコネクタ越しに中継する。
  // 参照先トークンは TokenProvider (D5) が解決する。 GET だけでなく POST /
  // PATCH / DELETE も透過 (write-through) し、 メソッド / ボディ / クエリを
  // そのまま転送する。
  r.all('/data/:service/:dataId', async (c) => {
    const { service, dataId } = c.req.param();
    const conn = registry.getConnector(service);
    if (!conn) return c.json({ error: 'service_not_found' }, 404);
    const manifest = conn.getManifest?.() ?? null;
    if (!manifest) {
      return c.json({ error: 'service_has_no_manifest' }, 404);
    }
    const endpoint = manifest.data.find((d) => d.id === dataId);
    if (!endpoint) return c.json({ error: 'data_not_found' }, 404);

    const token = await tokenProvider.getDownstreamToken(getUserToken(c), {
      service: conn.id,
      projectKey: manifest.cernereProjectKey ?? conn.id,
      baseUrl: conn.baseUrl,
    });
    const method = c.req.method;
    const headers: Record<string, string> = {};
    if (token) headers['authorization'] = `Bearer ${token}`;
    const init: RequestInit = { method, headers };
    if (method !== 'GET' && method !== 'HEAD') {
      init.body = await c.req.text();
      headers['content-type'] =
        c.req.header('content-type') ?? 'application/json';
    }

    // endpoint.path の :param を _cp_<param> クエリで埋め、 _cp_* は転送から除く
    // (宣言的レンダラの action が paramater 付きパスを叩くため、 §13)
    let resolvedPath = endpoint.path;
    const forwardParams = new URLSearchParams();
    for (const [k, v] of new URL(c.req.url).searchParams) {
      if (k.startsWith('_cp_')) {
        resolvedPath = resolvedPath.replace(`:${k.slice(4)}`, encodeURIComponent(v));
      } else {
        forwardParams.set(k, v);
      }
    }
    const search = forwardParams.toString() ? `?${forwardParams.toString()}` : '';

    let res: Response;
    try {
      res = await conn.fetch(resolvedPath + search, init);
    } catch (e) {
      return c.json({ error: 'connector_error', detail: String(e) }, 502);
    }
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: {
        'content-type': res.headers.get('content-type') ?? 'application/json',
      },
    });
  });

  // external-id マッピング (案B) — admin 専用。
  r.get('/external-ids', requireAdmin, (c) =>
    c.json({ mappings: listExternalIdMappings(db) }),
  );

  // (issuer, sub) の指す external-id を張り替える (マージ)。
  r.post('/external-ids/reassign', requireAdmin, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      issuer?: string;
      sub?: string;
      externalId?: string;
    };
    const { issuer, sub, externalId } = body;
    if (!issuer || !sub || !externalId) {
      return c.json({ error: 'issuer_sub_externalId_required' }, 422);
    }
    if (!reassignExternalId(db, issuer, sub, externalId)) {
      return c.json({ error: 'mapping_not_found' }, 404);
    }
    return c.json({ ok: true });
  });

  // discovery (連携先) を runtime に読む / 差し替える — spec/feature/runtime-discovery.md
  //
  //  - GET  /discovery        現在の config + locked + 候補一覧 (mode/scope)
  //  - PUT  /discovery        config 差し替え。 locked のときは 423、 不正 body は 400
  //
  // 認証なしユーザに連携先を露出しないよう admin only。 4-引数の旧シグネチャで
  // 作られた router には controller が無いので 503 にする (= 旧呼び出し互換)。
  r.get('/discovery', requireAdmin, (c) => {
    if (!discoveryController) {
      return c.json({ error: 'discovery_controller_unavailable' }, 503);
    }
    return c.json({
      config: discoveryController.getConfig(),
      locked: discoveryController.isLocked(),
    });
  });
  r.put('/discovery', requireAdmin, async (c) => {
    if (!discoveryController) {
      return c.json({ error: 'discovery_controller_unavailable' }, 503);
    }
    if (discoveryController.isLocked()) {
      return c.json(
        { error: 'discovery_locked', detail: 'this Corpus pins discovery at boot' },
        423,
      );
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    let next;
    try {
      next = normalizeDiscoveryConfig(body);
    } catch (e) {
      return c.json({ error: 'invalid_config', detail: (e as Error).message }, 400);
    }
    try {
      await discoveryController.setConfig(next);
    } catch (e) {
      return c.json({ error: 'setConfig_failed', detail: (e as Error).message }, 500);
    }
    return c.json({ ok: true, config: discoveryController.getConfig() });
  });

  return r;
}
