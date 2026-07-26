// モジュール類型 1: 自前データ。
// Hub の SQLite だけで完結する社内お知らせ。 投稿・削除は admin のみ。

import { Hono, getIdentity, cacheDisplayName } from '../../../server/hub/sdk.ts';
import type { CorpusModule, CorpusContext } from '../../../server/hub/sdk.ts';
import {
  ensureSchema,
  listAnnouncements,
  insertAnnouncement,
  getAnnouncement,
  deleteAnnouncement,
  type AnnouncementRow,
} from '../data.ts';

const LIST_LIMIT = 100;
const MAX_TITLE = 120;
const MAX_BODY = 4_000;

interface AnnouncementInput {
  title: string;
  body: string;
  pinned: boolean;
}

function view(row: AnnouncementRow): Record<string, unknown> {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    pinned: row.pinned === 1,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

/** 手書きの入力検証。 パックが zod を持つならそちらへ寄せてよい。 */
function parseInput(raw: unknown): AnnouncementInput | string {
  if (typeof raw !== 'object' || raw === null) return 'body must be an object';
  const { title, body, pinned } = raw as Record<string, unknown>;
  if (typeof title !== 'string' || title.trim() === '') return 'title is required';
  if (title.length > MAX_TITLE) return `title must be <= ${MAX_TITLE} chars`;
  if (body !== undefined && typeof body !== 'string') return 'body must be a string';
  if ((body as string | undefined ?? '').length > MAX_BODY) return `body must be <= ${MAX_BODY} chars`;
  if (pinned !== undefined && typeof pinned !== 'boolean') return 'pinned must be a boolean';
  return { title: title.trim(), body: (body as string | undefined ?? '').trim(), pinned: pinned === true };
}

const announcements: CorpusModule = {
  id: 'announcements',
  title: 'お知らせ',
  icon: '📣',

  setup(ctx: CorpusContext): void {
    ensureSchema(ctx.db);

    const api = new Hono();

    api.get('/', (c) => {
      const identity = getIdentity(c);
      // 表示名キャッシュは 「見かけた時に育てる」。 正本は Cernere。
      if (identity.displayName) cacheDisplayName(ctx.db, identity.externalId, identity.displayName);
      return c.json({ items: listAnnouncements(ctx.db, LIST_LIMIT).map(view) });
    });

    api.post('/', async (c) => {
      const identity = getIdentity(c);
      if (!identity.isAdmin) return c.json({ error: 'admin_only' }, 403);
      const parsed = parseInput(await c.req.json().catch(() => null));
      if (typeof parsed === 'string') return c.json({ error: parsed }, 400);
      const id = insertAnnouncement(ctx.db, { ...parsed, createdBy: identity.externalId });
      const row = getAnnouncement(ctx.db, id);
      ctx.logger.info(`announcement ${id} posted by ${identity.externalId}`);
      return c.json(row ? view(row) : { id }, 201);
    });

    api.delete('/:id', (c) => {
      const identity = getIdentity(c);
      const id = Number(c.req.param('id'));
      if (!Number.isInteger(id)) return c.json({ error: 'invalid_id' }, 400);
      const row = getAnnouncement(ctx.db, id);
      if (!row) return c.json({ error: 'not_found' }, 404);
      // admin か投稿者本人だけが消せる。
      if (!identity.isAdmin && row.created_by !== identity.externalId) {
        return c.json({ error: 'forbidden' }, 403);
      }
      deleteAnnouncement(ctx.db, id);
      return c.json({ deleted: id });
    });

    ctx.registerRoute(api);
    // 上位 hub から集約できるよう、 データ経路をマニフェストに宣言する (D6)。
    ctx.registerData({ id: 'announcements', path: '/', title: 'お知らせ', scope: 'local' });
    ctx.registerPanel({ title: 'お知らせ', icon: '📣' });
  },
};

export default announcements;
