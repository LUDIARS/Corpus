// local/multi 集約ロジック。
//
// 全コネクタの health を定期チェックして connector_health に保存し、
// /api/hub/overview 用のサマリを組み立てる。

import type { CorpusDb } from '../db.ts';
import type { HubRegistry } from './registry.ts';
import type { ConnectorHealth, ConnectorInfo } from './types.ts';

const HEALTH_TIMEOUT_MS = 5000;

async function withTimeout(
  p: Promise<ConnectorHealth>,
): Promise<ConnectorHealth> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<ConnectorHealth>((resolveTimeout) => {
    timer = setTimeout(
      () => resolveTimeout({ status: 'down', detail: 'health timeout' }),
      HEALTH_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 全コネクタを health チェックし、 結果を DB に保存して Map で返す。 */
export async function runHealthChecks(
  registry: HubRegistry,
  db: CorpusDb,
): Promise<Map<string, ConnectorHealth>> {
  const result = new Map<string, ConnectorHealth>();
  const upsert = db.prepare(
    `INSERT INTO connector_health (connector_id, scope, status, detail, checked_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(connector_id) DO UPDATE SET
       scope = excluded.scope, status = excluded.status,
       detail = excluded.detail, checked_at = excluded.checked_at`,
  );
  const now = Date.now();
  await Promise.all(
    registry.listConnectors().map(async (c) => {
      let health: ConnectorHealth;
      try {
        health = await withTimeout(Promise.resolve(c.health()));
      } catch (e) {
        health = { status: 'down', detail: (e as Error).message };
      }
      result.set(c.id, health);
      upsert.run(c.id, c.scope, health.status, health.detail ?? null, now);
    }),
  );
  return result;
}

export interface HubOverview {
  checkedAt: number;
  local: ConnectorInfo[];
  multi: ConnectorInfo[];
  counts: { up: number; degraded: number; down: number };
}

/** /api/hub/overview 用に local / multi へ振り分けたサマリを作る。 */
export async function buildOverview(
  registry: HubRegistry,
  db: CorpusDb,
): Promise<HubOverview> {
  const healths = await runHealthChecks(registry, db);
  const infos = registry.connectorInfos(healths);
  const counts = { up: 0, degraded: 0, down: 0 };
  for (const i of infos) counts[i.health.status]++;
  return {
    checkedAt: Date.now(),
    local: infos.filter((i) => i.scope === 'local'),
    multi: infos.filter((i) => i.scope === 'multi'),
    counts,
  };
}

/** 起動後の定期 health チェックを仕掛ける。 */
export function startHealthLoop(
  registry: HubRegistry,
  db: CorpusDb,
  intervalMs = 60_000,
): void {
  void runHealthChecks(registry, db);
  const timer = setInterval(() => void runHealthChecks(registry, db), intervalMs);
  timer.unref?.();
}
