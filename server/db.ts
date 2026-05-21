// Corpus 本体の SQLite。 better-sqlite3 / WAL。
//
// Corpus 本体が持つテーブルは最小 (user_display_cache / connector_health)。
// プラグインパックのモジュールは同じ Database ハンドルに自分のテーブルを
// `CREATE IF NOT EXISTS` で足してよい (ctx.db 経由)。
//
// migration 規約: 新規カラムは ALTER ADD COLUMN、 そのカラム用 INDEX は
// ALTER の直後に冪等発行する (CREATE TABLE と同じ exec に置くと既存 DB で
// 「no such column」 boot 失敗するため — feedback_sqlite_create_index_after_alter)。

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export type CorpusDb = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS user_display_cache (
  user_id     TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS connector_health (
  connector_id TEXT PRIMARY KEY,
  scope        TEXT NOT NULL,
  status       TEXT NOT NULL,
  detail       TEXT,
  checked_at   INTEGER NOT NULL
);

-- external-id マッピング層 (Corpus 設計 案B)。
-- (Cernere issuer, sub) → 再割当可能な external-id (UUID)。 複数の (issuer,sub)
-- が 1 つの external-id を指せる (多対一 = 同一人物の複数 Cernere アカウント)。
-- 共有データ型はこの external-id を owner 識別子に使う (NULL=自分)。
CREATE TABLE IF NOT EXISTS external_id_map (
  issuer      TEXT NOT NULL,
  sub         TEXT NOT NULL,
  external_id TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (issuer, sub)
);
CREATE INDEX IF NOT EXISTS external_id_map_eid ON external_id_map(external_id);
`;

export function openDb(dbPath: string): CorpusDb {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  // ここで将来 ALTER ADD COLUMN → 直後に CREATE INDEX を冪等発行する
  return db;
}

/** display name を Cernere の解決結果でキャッシュする。 */
export function cacheDisplayName(
  db: CorpusDb,
  userId: string,
  name: string,
): void {
  db.prepare(
    `INSERT INTO user_display_cache (user_id, name, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET name = excluded.name,
       updated_at = excluded.updated_at`,
  ).run(userId, name, Date.now());
}

export function getDisplayName(db: CorpusDb, userId: string): string | null {
  const row = db
    .prepare(`SELECT name FROM user_display_cache WHERE user_id = ?`)
    .get(userId) as { name: string } | undefined;
  return row?.name ?? null;
}

// ── external-id マッピング層 (案B) ──────────────────────────────────────────

export interface ExternalIdMapping {
  issuer: string;
  sub: string;
  externalId: string;
  createdAt: number;
}

/**
 * (issuer, sub) → external-id を get-or-create する。
 * 未登録なら新しい UUID を発行して登録する。
 */
export function resolveExternalId(
  db: CorpusDb,
  issuer: string,
  sub: string,
): string {
  const row = db
    .prepare(`SELECT external_id FROM external_id_map WHERE issuer = ? AND sub = ?`)
    .get(issuer, sub) as { external_id: string } | undefined;
  if (row) return row.external_id;
  const externalId = randomUUID();
  db.prepare(
    `INSERT INTO external_id_map (issuer, sub, external_id, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(issuer, sub, externalId, Date.now());
  return externalId;
}

/** 全マッピングを列挙する (admin 用)。 */
export function listExternalIdMappings(db: CorpusDb): ExternalIdMapping[] {
  const rows = db
    .prepare(
      `SELECT issuer, sub, external_id, created_at FROM external_id_map
       ORDER BY external_id, issuer, sub`,
    )
    .all() as Array<{
    issuer: string;
    sub: string;
    external_id: string;
    created_at: number;
  }>;
  return rows.map((r) => ({
    issuer: r.issuer,
    sub: r.sub,
    externalId: r.external_id,
    createdAt: r.created_at,
  }));
}

/**
 * (issuer, sub) の指す external-id を張り替える (admin によるマージ)。
 * 対象が存在しなければ false。
 */
export function reassignExternalId(
  db: CorpusDb,
  issuer: string,
  sub: string,
  targetExternalId: string,
): boolean {
  const res = db
    .prepare(
      `UPDATE external_id_map SET external_id = ? WHERE issuer = ? AND sub = ?`,
    )
    .run(targetExternalId, issuer, sub);
  return res.changes > 0;
}
