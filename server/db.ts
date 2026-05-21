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
