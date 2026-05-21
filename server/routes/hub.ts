// /api/hub/* — hub frontend が叩く集約 API。

import { Hono } from 'hono';
import type { CorpusDb } from '../db.ts';
import { buildOverview } from '../hub/aggregate.ts';
import type { HubRegistry } from '../hub/registry.ts';
import type { ConnectorInfo } from '../hub/types.ts';

interface HealthRow {
  connector_id: string;
  status: string;
  detail: string | null;
  checked_at: number;
}

export function makeHubRouter(registry: HubRegistry, db: CorpusDb): Hono {
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

  return r;
}
