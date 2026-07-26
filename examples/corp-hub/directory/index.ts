// モジュール類型 2: 個人データを Cernere に預ける。
//
// 氏名・部署・役職といった個人データの正本は Cernere であり、 Hub 側 SQLite へ
// 複製しない。 Hub が持ってよいのは external-id と 「表示名キャッシュ」 だけ
// (DESIGN.md §7 / §11)。 このモジュールはその線引きを示すための最小実装。

import { Hono, getIdentity, cacheDisplayName } from '../../../server/hub/sdk.ts';
import type { CorpusModule, CorpusContext } from '../../../server/hub/sdk.ts';
import { ensureSchema, listCachedMembers, listStaleMembers } from '../data.ts';

const MEMBER_LIMIT = 200;
/** 棚卸しの既定しきい値。 これ以上アクセスの無い人を退職者候補として出す。 */
const STALE_DEFAULT_DAYS = 90;
const STALE_MIN_DAYS = 1;
const STALE_MAX_DAYS = 3_650;
const DAY_MS = 86_400_000;

const directory: CorpusModule = {
  id: 'directory',
  title: '名簿',
  icon: '👥',

  setup(ctx: CorpusContext): void {
    ensureSchema(ctx.db);

    const api = new Hono();

    // 自分の identity。 プロフィール本体を返すのではなく、 Cernere が正本である
    // ことを前提に 「この Hub が知っている自分」 だけを返す。
    api.get('/me', (c) => {
      const identity = getIdentity(c);
      if (identity.displayName) cacheDisplayName(ctx.db, identity.externalId, identity.displayName);
      return c.json({
        externalId: identity.externalId,
        displayName: identity.displayName,
        isAdmin: identity.isAdmin,
        // 氏名・部署・役職を足したくなったら、 ここではなく Cernere の
        // project_data_<key> に列を足してコネクタ越しに読むこと。
        profileSource: 'cernere',
      });
    });

    // この Hub が一度でも見たことのある人の一覧 (キャッシュ)。
    // 「全社員名簿」 ではないことを source で明示する。
    api.get('/members', (c) => {
      const items = listCachedMembers(ctx.db, MEMBER_LIMIT).map((row) => ({
        externalId: row.user_id,
        displayName: row.name,
        seenAt: row.updated_at,
      }));
      return c.json({ items, source: 'display-name-cache' });
    });

    // 棚卸し — 一定期間この Hub にアクセスの無いメンバー (退職者候補)。
    //
    // 見ているのは 「この Hub への最終アクセス」 であり Cernere 全体の最終ログインでは
    // ない。 Cernere の edge assertion (auth.edge_assertion) が入ったら、 データ元を
    // `edge_idp.stale_identities` へ差し替える。 削除自体は Cernere 側の
    // `edge_idp.purge_user` (step-up 必須) が担当し、 Hub は候補を出すだけに留める。
    api.get('/stale', (c) => {
      const identity = getIdentity(c);
      if (!identity.isAdmin) return c.json({ error: 'admin_only' }, 403);

      const raw = c.req.query('days');
      const days = raw === undefined ? STALE_DEFAULT_DAYS : Number(raw);
      if (!Number.isInteger(days) || days < STALE_MIN_DAYS || days > STALE_MAX_DAYS) {
        return c.json({ error: 'invalid_days' }, 400);
      }

      const now = Date.now();
      const items = listStaleMembers(ctx.db, now - days * DAY_MS, MEMBER_LIMIT).map((row) => ({
        externalId: row.user_id,
        displayName: row.name,
        seenAt: row.updated_at,
        daysSinceSeen: Math.floor((now - row.updated_at) / DAY_MS),
      }));
      return c.json({ items, days, source: 'hub-last-access' });
    });

    ctx.registerRoute(api);
    ctx.registerData({ id: 'members', path: '/members', title: '名簿 (キャッシュ)', scope: 'local' });
    ctx.registerData({ id: 'stale', path: '/stale', title: '棚卸し候補', scope: 'local' });
    ctx.registerPanel({ title: '名簿', icon: '👥' });
  },
};

export default directory;
