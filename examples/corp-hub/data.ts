// 企業用 Hub テンプレートの SQLite スキーマ集約。
//
// スキーマ変更はこのファイルに集める (モジュール間で定義が散らないようにする)。
// migration 規約: CREATE IF NOT EXISTS + ALTER 後付け。 新規カラム用 INDEX は
// ALTER ADD COLUMN の直後に冪等発行する。

import type { CorpusDb } from '../../server/hub/sdk.ts';

/** テーブル名の接頭辞。 Corpus 本体・他パックとの衝突を避ける。 */
const PREFIX = 'corp';

let applied = false;

/**
 * このパックが使うテーブルを用意する。 各モジュールの setup() から呼ぶ
 * (どのモジュールが先に立ち上がっても冪等)。
 */
export function ensureSchema(db: CorpusDb): void {
  if (applied) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${PREFIX}_announcement (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT    NOT NULL,
      body        TEXT    NOT NULL DEFAULT '',
      pinned      INTEGER NOT NULL DEFAULT 0,
      created_by  TEXT    NOT NULL,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_${PREFIX}_announcement_created
      ON ${PREFIX}_announcement (pinned DESC, created_at DESC);
  `);
  applied = true;
}

export interface AnnouncementRow {
  id: number;
  title: string;
  body: string;
  pinned: number;
  created_by: string;
  created_at: number;
}

export function listAnnouncements(db: CorpusDb, limit: number): AnnouncementRow[] {
  return db.prepare(
    `SELECT id, title, body, pinned, created_by, created_at
       FROM ${PREFIX}_announcement
      ORDER BY pinned DESC, created_at DESC
      LIMIT ?`,
  ).all(limit) as AnnouncementRow[];
}

export function insertAnnouncement(
  db: CorpusDb,
  input: { title: string; body: string; pinned: boolean; createdBy: string },
): number {
  const info = db.prepare(
    `INSERT INTO ${PREFIX}_announcement (title, body, pinned, created_by, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(input.title, input.body, input.pinned ? 1 : 0, input.createdBy, Date.now());
  return Number(info.lastInsertRowid);
}

export function getAnnouncement(db: CorpusDb, id: number): AnnouncementRow | null {
  const row = db.prepare(
    `SELECT id, title, body, pinned, created_by, created_at
       FROM ${PREFIX}_announcement WHERE id = ?`,
  ).get(id) as AnnouncementRow | undefined;
  return row ?? null;
}

export function deleteAnnouncement(db: CorpusDb, id: number): boolean {
  return db.prepare(`DELETE FROM ${PREFIX}_announcement WHERE id = ?`).run(id).changes > 0;
}

/**
 * 表示名キャッシュの一覧。 正本は Cernere で、 ここにあるのはあくまで
 * 「この Hub が一度でも見たことのある人」 のキャッシュ (Corpus 本体の
 * user_display_cache)。 名簿の正本として扱わないこと。
 */
export function listCachedMembers(
  db: CorpusDb,
  limit: number,
): CachedMemberRow[] {
  return db.prepare(
    `SELECT user_id, name, updated_at
       FROM user_display_cache
      ORDER BY updated_at DESC
      LIMIT ?`,
  ).all(limit) as CachedMemberRow[];
}

export interface CachedMemberRow {
  user_id: string;
  name: string;
  updated_at: number;
}

/**
 * 指定時刻より前にしか観測されていないメンバー = 棚卸し候補。
 *
 * ここで見ているのは 「この Hub への最終アクセス」 であり、 Cernere 全体の最終ログイン
 * ではない。 Cernere の edge assertion 実装が入ったら、 データ元を
 * `edge_idp.stale_identities` (last_seen_at ベース) へ差し替える。
 */
export function listStaleMembers(
  db: CorpusDb,
  seenBefore: number,
  limit: number,
): CachedMemberRow[] {
  return db.prepare(
    `SELECT user_id, name, updated_at
       FROM user_display_cache
      WHERE updated_at < ?
      ORDER BY updated_at ASC
      LIMIT ?`,
  ).all(seenBefore, limit) as CachedMemberRow[];
}
