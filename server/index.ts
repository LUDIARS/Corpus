// Corpus server entry — Hono + better-sqlite3 + Cernere PASETO V4 + hub 機構。
//
// 起動シーケンス:
//   1. env / dirs を解決
//   2. SQLite 開いて schema 適用
//   3. Cernere 公開鍵 fetch ループ start
//   4. HubRegistry を組み立て、 組み込みコネクタ + プラグインパックをロード
//   5. router を mount → listen → health ループ start

import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDb } from './db.ts';
import { requireAuth, startAuth } from './auth.ts';
import { HubRegistry } from './hub/registry.ts';
import { startHealthLoop } from './hub/aggregate.ts';
import { readDiscoveryConfig, startDiscoveryLoop } from './hub/discovery.ts';
import { makeTokenProvider } from './hub/tokens.ts';
import { SelfConnector } from './connectors/builtin.ts';
import { makeHubRouter } from './routes/hub.ts';
import { makeMeRouter } from './routes/me.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 必須 env を取り出す。 未設定なら落とす (= 暗黙 fallback は禁止)。 */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    console.error(
      `[corpus] ${name} が未設定です。 Infisical / .env.secrets / .env / host env のいずれかで指定してください。`,
    );
    process.exit(1);
  }
  return v.trim();
}

const PORT = Number(process.env.CORPUS_PORT ?? 5185);
const DATA_DIR = resolve(
  process.env.CORPUS_DATA && process.env.CORPUS_DATA.trim()
    ? process.env.CORPUS_DATA
    : join(__dirname, '..', 'data'),
);
const DB_PATH = join(DATA_DIR, 'corpus.db');

// frontend (public/) の所在。 用途特化 hub は Corpus を submodule で取り込み
// 別 cwd から起動するため、 cwd 相対ではなく明示パスで解決する。
const PUBLIC_DIR = resolve(
  process.env.CORPUS_PUBLIC_DIR && process.env.CORPUS_PUBLIC_DIR.trim()
    ? process.env.CORPUS_PUBLIC_DIR
    : join(__dirname, '..', 'public'),
);

const NO_AUTH = process.env.CORPUS_NO_AUTH === '1';
const CERNERE_BASE_URL = NO_AUTH
  ? (process.env.CERNERE_BASE_URL?.trim() || 'http://noauth.invalid')
  : requireEnv('CERNERE_BASE_URL');
const AUDIENCE = NO_AUTH
  ? (process.env.CORPUS_PUBLIC_URL?.trim() || `http://localhost:${PORT}`)
  : requireEnv('CORPUS_PUBLIC_URL');
// external-id マッピングの issuer。 単一 Cernere 運用では CERNERE_BASE_URL を使う。
const CERNERE_ISSUER =
  process.env.CORPUS_CERNERE_ISSUER?.trim() || CERNERE_BASE_URL;
const ADMIN_IDS = new Set(
  (process.env.CORPUS_ADMIN_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

async function main(): Promise<void> {
  const db = openDb(DB_PATH);
  if (NO_AUTH) {
    console.log('[corpus] CORPUS_NO_AUTH=1 — Cernere 認証 bypass、 dev identity で起動');
  } else {
    startAuth({
      cernereBaseUrl: CERNERE_BASE_URL,
      adminIds: ADMIN_IDS,
      db,
      issuer: CERNERE_ISSUER,
    });
  }

  // hub 機構: 組み込みコネクタ + プラグインパック
  const registry = new HubRegistry(db);
  registry.addConnector(new SelfConnector());
  await registry.loadPluginPacks(process.env.CORPUS_PLUGIN_DIR);

  // discovery (D1) + 認証トークン伝播 (D5)
  const discoveryCfg = readDiscoveryConfig();
  const tokenProvider = makeTokenProvider(
    process.env.CORPUS_TOKEN_MODE,
    CERNERE_BASE_URL,
  );

  const app = new Hono();
  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );

  // health は認証不要 — auth middleware より前に登録する
  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      service: 'corpus',
      port: PORT,
      modules: registry.listModules().map((m) => m.id),
    }),
  );

  // frontend が Cernere ログインへ飛ぶための公開設定 (認証不要)
  app.get('/api/public-config', (c) =>
    c.json({
      service: 'corpus',
      cernereBaseUrl: CERNERE_BASE_URL,
      publicUrl: AUDIENCE,
    }),
  );

  // pre-auth ログイン UI (§11.4) — Cernere の login UI キー (html 直接定義) を
  // host (Corpus) が中継する。 認証不要 (requireAuth より前)。
  app.get('/auth/ui', async (c) => {
    try {
      const r = await fetch(`${CERNERE_BASE_URL}/api/corpus/ui/login`);
      if (!r.ok) return c.json({ error: 'login_ui_unavailable' }, 502);
      return c.json((await r.json()) as Record<string, unknown>);
    } catch (e) {
      return c.json({ error: 'login_ui_fetch_failed', detail: String(e) }, 502);
    }
  });

  // pre-auth ログイン代行 — host が Cernere /api/auth/login へ中継し accessToken
  // を返す (ブラウザ→Cernere の CORS 回避 + §11.4 host 代行)。
  app.post('/auth/login', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    try {
      const r = await fetch(`${CERNERE_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      return c.json(data, r.ok ? 200 : 401);
    } catch (e) {
      return c.json({ error: 'login_proxy_failed', detail: String(e) }, 502);
    }
  });

  // ── §12.3 HMR: UI キー version を polling して shell に push ──────────
  // サービスの UI キー (descriptor/html) の version (file mtime) が上がったら、
  // 接続中の shell に SSE で通知 → shell は該当パネルだけ再描画 (Vite HMR 相当)。
  type SSEWriter = { writeSSE: (m: { data: string; event?: string }) => Promise<void> };
  const hmrClients = new Set<SSEWriter>();
  const lastUiVersions = new Map<string, number>();

  // SSE チャネル (認証不要 — key 変更の signal のみ、 データは流さない)。
  app.get('/ui-hmr', (c) =>
    streamSSE(c, async (stream) => {
      hmrClients.add(stream);
      stream.onAbort(() => {
        hmrClients.delete(stream);
      });
      await stream.writeSSE({ data: 'connected', event: 'hello' });
      while (!stream.aborted) {
        await stream.sleep(25_000);
        await stream.writeSSE({ data: 'ping', event: 'ping' });
      }
    }),
  );

  async function pollUiVersions(): Promise<void> {
    for (const conn of registry.listConnectors()) {
      const base = (conn as { baseUrl?: string }).baseUrl;
      if (!base) continue;
      let versions: Record<string, number>;
      try {
        const r = await fetch(`${base}/api/corpus/ui-versions`);
        if (!r.ok) continue;
        versions = (await r.json()) as Record<string, number>;
      } catch {
        continue;
      }
      for (const [key, version] of Object.entries(versions)) {
        const mapKey = `${conn.id}:${key}`;
        const prev = lastUiVersions.get(mapKey);
        lastUiVersions.set(mapKey, version);
        if (prev !== undefined && prev !== version) {
          const data = JSON.stringify({ service: conn.id, key, version });
          for (const s of hmrClients) void s.writeSSE({ data, event: 'ui-changed' });
          console.log(`[corpus] HMR: ${conn.id}/${key} → v${version}`);
        }
      }
    }
  }
  const hmrTimer = setInterval(() => void pollUiVersions(), 1500);
  hmrTimer.unref?.();

  // 自身のサービスマニフェスト (D6) — 別の Corpus から参照される時に使う。
  // data[] はプラグインが registerData で宣言した分、 panels[] はプラグインの
  // パネル (entry は /plugins/<id>/<file> の絶対パス)。
  app.get('/.well-known/corpus-service.json', (c) => {
    const own = registry.ownManifest();
    return c.json({
      service: process.env.CORPUS_SERVICE_ID ?? 'corpus',
      displayName: process.env.CORPUS_DISPLAY_NAME ?? 'Corpus',
      version: '1.0.0',
      corpusApi: 1,
      health: '/api/health',
      data: own.data,
      panels: own.panels,
      auth: 'cernere-project-token',
      cernereProjectKey: process.env.CORPUS_SERVICE_ID ?? 'corpus',
    });
  });

  // /api/* は health を除き Cernere 認証必須
  app.use('/api/*', requireAuth);
  app.route('/api/me', makeMeRouter(db));
  // discovery loop は wiring の中で動的に差し替え可 — controller を hub router
  // に渡して runtime mutation API を有効化する (spec/feature/runtime-discovery.md)。
  // boot 時 `CORPUS_DISCOVERY_LOCKED=1` (継承先 VantanHub 等が固定したい場合) で
  // 設定変更を 423 にロックできる。
  const discoveryLocked =
    String(process.env.CORPUS_DISCOVERY_LOCKED ?? '').trim() === '1';
  const discoveryController = startDiscoveryLoop(registry, discoveryCfg, {
    locked: discoveryLocked,
  });
  app.route(
    '/api/hub',
    makeHubRouter({ registry, db, tokenProvider, discoveryController }),
  );
  // プラグインモジュールの API を /api/x/<moduleId> に mount
  registry.mountRoutes(app);

  // プラグインモジュールの panel スクリプトを静的配信 (UI コードなので認証不要)
  app.get('/plugins/:moduleId/:file', (c) => {
    const { moduleId, file } = c.req.param();
    if (!/^[a-zA-Z0-9._-]+$/.test(file) || file.includes('..')) {
      return c.json({ error: 'bad_path' }, 400);
    }
    const dir = registry.getModuleDir(moduleId);
    if (!dir) return c.json({ error: 'module_not_found' }, 404);
    const full = join(dir, file);
    if (!existsSync(full)) return c.json({ error: 'file_not_found' }, 404);
    const body = readFileSync(full);
    const type = CONTENT_TYPES[extname(file)] ?? 'application/octet-stream';
    return c.body(body, 200, { 'content-type': type });
  });

  // 参照サービスが公開する Corpus 用 UI コンポーネント (D4) をプロキシ配信。
  // /api/* の外なので未認証 — UI コードなので動的 import 可能にする。
  // パス規約統一: マニフェスト panels[].entry は参照先での絶対パス
  // (例 /corpus-ui/loans.js, /plugins/presence/panel.js)。 ここはその
  // 全パスをそのまま参照先へ中継する。
  app.get('/hub-ui/:service/*', async (c) => {
    const service = c.req.param('service');
    const prefix = `/hub-ui/${service}/`;
    // /hub-ui/<service> より後ろ (先頭スラッシュ込み) を参照先パスとする
    const rest = c.req.path.startsWith(prefix)
      ? c.req.path.slice(prefix.length - 1)
      : '';
    if (!rest || rest.includes('..')) {
      return c.json({ error: 'bad_path' }, 400);
    }
    const conn = registry.getConnector(service);
    if (!conn) return c.json({ error: 'service_not_found' }, 404);
    let res: Response;
    try {
      res = await conn.fetch(rest);
    } catch {
      return c.json({ error: 'connector_error' }, 502);
    }
    if (!res.ok) return c.json({ error: 'ui_unavailable' }, 404);
    const body = Buffer.from(await res.arrayBuffer());
    const type = CONTENT_TYPES[extname(rest)] ?? 'application/octet-stream';
    return c.body(body, 200, { 'content-type': type });
  });

  // frontend shell — PUBLIC_DIR から直接配信 (cwd 非依存)
  const serveFromPublic = (c: Context, file: string): Response => {
    if (file.includes('..') || !/^[a-zA-Z0-9._-]+$/.test(file)) {
      return c.json({ error: 'bad_path' }, 400);
    }
    const full = join(PUBLIC_DIR, file);
    if (!existsSync(full)) return c.json({ error: 'not_found' }, 404);
    const type = CONTENT_TYPES[extname(file)] ?? 'application/octet-stream';
    return c.body(readFileSync(full), 200, { 'content-type': type });
  };
  app.get('/', (c) => serveFromPublic(c, 'index.html'));
  app.get('/index.html', (c) => serveFromPublic(c, 'index.html'));
  app.get('/app.js', (c) => serveFromPublic(c, 'app.js'));
  app.get('/app.js.map', (c) => serveFromPublic(c, 'app.js.map'));
  app.get('/style.css', (c) => serveFromPublic(c, 'style.css'));
  // vendor/ — 3rd-party assets (dockview.css 等)。 1 階層のみ許可.
  app.get('/vendor/:file', (c) => {
    const file = c.req.param('file');
    if (!file || file.includes('..') || !/^[a-zA-Z0-9._-]+$/.test(file)) {
      return c.json({ error: 'bad_path' }, 400);
    }
    const full = join(PUBLIC_DIR, 'vendor', file);
    if (!existsSync(full)) return c.json({ error: 'not_found' }, 404);
    const type = CONTENT_TYPES[extname(file)] ?? 'application/octet-stream';
    return c.body(readFileSync(full), 200, { 'content-type': type });
  });
  app.notFound((c) => {
    const url = new URL(c.req.url);
    if (url.pathname.startsWith('/api/')) return c.json({ error: 'not_found' }, 404);
    return c.redirect('/');
  });

  serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`[corpus] listening on http://localhost:${info.port}`);
    console.log(`[corpus] data dir: ${DATA_DIR}`);
    console.log(`[corpus] cernere: ${NO_AUTH ? '(bypassed)' : CERNERE_BASE_URL}`);
    console.log(
      `[corpus] mode: ${discoveryCfg.mode} / token: ${tokenProvider.mode}` +
        (discoveryCfg.remoteUrl ? ` / remote: ${discoveryCfg.remoteUrl}` : ''),
    );
    console.log(`[corpus] modules: ${registry.listModules().map((m) => m.id).join(', ') || '(none)'}`);
    console.log(`[corpus] connectors: ${registry.listConnectors().map((c) => c.id).join(', ') || '(none)'}`);
  });

  startHealthLoop(registry, db);
  // discovery loop は上で controller 経由で start 済 — ここでは何もしない。
}

void main();
