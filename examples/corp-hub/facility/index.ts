// モジュール類型 3: 外部サービスへのコネクタ。
//
// 会議室・設備の正本は Aedilis。 Hub は複製せず中継するだけ。 接続先が未設定 /
// 未稼働でも Hub は起動し、 パネルが 「未接続」 を表示する degraded モードで動く
// (DESIGN.md §4)。

import { Hono, HttpServiceConnector, getUserSession } from '../../../server/hub/sdk.ts';
import type { CorpusModule, CorpusContext, ServiceConnector } from '../../../server/hub/sdk.ts';

/** 接続先 Aedilis の URL。 未設定なら degraded で動く。 */
const BASE_URL_ENV = 'CORP_HUB_AEDILIS_URL';
/** 参照先トークン発行に使う Cernere managed project key。 */
const PROJECT_KEY_ENV = 'CORP_HUB_AEDILIS_PROJECT_KEY';

const facility: CorpusModule = {
  id: 'facility',
  title: '施設',
  icon: '🏢',

  setup(ctx: CorpusContext): void {
    const rawBaseUrl = ctx.env(BASE_URL_ENV)?.trim() ?? '';
    if (rawBaseUrl && !/^https?:\/\//.test(rawBaseUrl)) {
      // 「未設定なら degraded、 設定値が不正なら起動拒否」 が Corpus の作法。
      throw new Error(`${BASE_URL_ENV} must be an http(s) URL: ${rawBaseUrl}`);
    }
    const projectKey = ctx.env(PROJECT_KEY_ENV)?.trim();
    if (rawBaseUrl && !projectKey) throw new Error(`${PROJECT_KEY_ENV} is required for delegated facility access`);

    const connector: ServiceConnector = new HttpServiceConnector({
      id: 'aedilis',
      title: '施設予約 (Aedilis)',
      scope: 'multi',
      baseUrl: rawBaseUrl,
    });
    ctx.registerConnector(connector);

    const api = new Hono();

    api.get('/facilities', async (c) => {
      if (!rawBaseUrl) {
        return c.json({ items: [], connected: false, detail: `${BASE_URL_ENV} 未設定` });
      }
      const authorized = await ctx.tokenProvider.authorize(getUserSession(c), {
        service: 'aedilis',
        projectKey: projectKey ?? '',
        baseUrl: rawBaseUrl,
      }, { path: '/api/facilities', action: 'facility.list' });
      if (!authorized) return c.json({ error: 'downstream_token_unavailable' }, 503);

      const upstream = await connector.fetch(authorized.path, authorized.init).catch(() => null);
      if (!upstream || !upstream.ok) {
        ctx.logger.warn(`aedilis /api/facilities failed: ${upstream?.status ?? 'unreachable'}`);
        return c.json({ items: [], connected: false, detail: '接続先が応答しません' }, 502);
      }
      const payload = await upstream.json().catch(() => ({}));
      return c.json({ ...(payload as Record<string, unknown>), connected: true });
    });

    api.get('/health', async (c) => c.json(await connector.health()));

    ctx.registerRoute(api);
    ctx.registerData({ id: 'facilities', path: '/facilities', title: '施設一覧', scope: 'multi' });
    ctx.registerPanel({ title: '施設', icon: '🏢' });
  },
};

export default facility;
