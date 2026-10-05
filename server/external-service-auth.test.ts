import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { openDb, type CorpusDb } from './db.ts';
import {
  getIdentity,
  getServicePrincipal,
  getUserToken,
  requireAdmin,
  requireAuth,
  startAuth,
} from './auth.ts';
import {
  matchExternalServiceRoute,
  readExternalServiceAuthConfig,
} from './external-service-auth.ts';
import { CernereServiceTokenVerifier, decideServicePrincipal } from './service-token.ts';

const CERNERE = 'http://cernere.test';
const AUDIENCE = 'educationlab';
const USER_TOKEN = 'user-access-token';
const KID = 'k1';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const RAW_PUBLIC_KEY = (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(12);

function le64(n: number): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(n));
  return out;
}

function pae(pieces: Buffer[]): Buffer {
  return Buffer.concat([le64(pieces.length), ...pieces.flatMap((p) => [le64(p.length), p])]);
}

/** Cernere と同じ形 (footer に kid) の PASETO v4.public を署名する。 */
function signPaseto(claims: Record<string, unknown>, key: KeyObject = privateKey): string {
  const message = Buffer.from(JSON.stringify(claims));
  const footer = Buffer.from(JSON.stringify({ kid: KID }));
  const sig = sign(null, pae([Buffer.from('v4.public.'), message, footer, Buffer.alloc(0)]), key);
  return `v4.public.${Buffer.concat([message, sig]).toString('base64url')}.${footer.toString('base64url')}`;
}

function serviceClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'service',
    sub: 'glab-bot',
    aud: AUDIENCE,
    scope: ['glab-external:write'],
    exp: new Date(Date.now() + 10 * 60_000).toISOString(),
    ...overrides,
  };
}

interface ProbeBody {
  principal: { kind: string; sub: string; scope: string[] } | null;
  userToken: string | null;
  userId: string | null;
  identityError: string | null;
}

const fakeFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (url === `${CERNERE}/.well-known/cernere-public-key`) {
    return Response.json({ keys: [{ kid: KID, public_key: RAW_PUBLIC_KEY.toString('base64') }] });
  }
  if (url === `${CERNERE}/api/auth/me`) {
    const auth = new Headers(init?.headers).get('authorization');
    if (auth === `Bearer ${USER_TOKEN}`) return Response.json({ id: 'user-1', name: 'User', role: 'general' });
    return new Response('unauthorized', { status: 401 });
  }
  return new Response('not found', { status: 404 });
});

let db: CorpusDb;
let stop: (() => void) | null = null;

function start(enabled: boolean): void {
  stop = startAuth({
    cernereBaseUrl: CERNERE,
    adminIds: new Set(),
    db,
    issuer: CERNERE,
    cookieSecure: false,
    externalService: enabled
      ? {
          modules: new Set(['consult']),
          headerNames: ['x-glab-service-token', 'x-projecthub-service-token'],
          verifier: new CernereServiceTokenVerifier({ cernereBaseUrl: CERNERE, audience: AUDIENCE }),
        }
      : null,
  });
}

function makeApp(): Hono {
  const app = new Hono();
  app.use('/api/*', requireAuth);
  const probe = (c: Parameters<typeof getServicePrincipal>[0]) => {
    let identityError: string | null = null;
    let userId: string | null = null;
    try {
      userId = getIdentity(c).userId;
    } catch (e) {
      identityError = (e as Error).message;
    }
    return c.json({
      principal: getServicePrincipal(c),
      userToken: getUserToken(c),
      userId,
      identityError,
    });
  };
  app.get('/api/x/consult/external/notifications', probe);
  app.get('/api/x/consult/admin-only', requireAdmin, probe);
  app.get('/api/x/consult/list', probe);
  app.get('/api/x/other/external/notifications', probe);
  return app;
}

beforeEach(() => {
  vi.stubGlobal('fetch', fakeFetch);
  delete process.env.CORPUS_NO_AUTH;
  db = openDb(':memory:');
});

afterEach(() => {
  stop?.();
  stop = null;
  db.close();
  vi.unstubAllGlobals();
  fakeFetch.mockClear();
});

describe('requireAuth — プラグイン外部経路の Cernere service token', () => {
  it('有効化 + 外部経路 + 正しい service token は通過し、 service 主体が積まれる', async () => {
    start(true);
    const res = await makeApp().request('/api/x/consult/external/notifications', {
      headers: { 'x-glab-service-token': signPaseto(serviceClaims()) },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as ProbeBody;
    expect(body.principal).toEqual({ kind: 'service', sub: 'glab-bot', scope: ['glab-external:write'] });
    expect(body.userToken).toBeNull();
    expect(body.userId).toBeNull();
    // getIdentity (ユーザ前提) は service 主体では例外。
    expect(body.identityError).toMatch(/service principal/);
  });

  it('2 つ目の設定ヘッダ・Authorization: Bearer でも受理する', async () => {
    start(true);
    const app = makeApp();
    const viaAlt = await app.request('/api/x/consult/external/notifications', {
      headers: { 'x-projecthub-service-token': signPaseto(serviceClaims()) },
    });
    expect(viaAlt.status).toBe(200);
    const viaBearer = await app.request('/api/x/consult/external/notifications', {
      headers: { authorization: `Bearer ${signPaseto(serviceClaims())}` },
    });
    expect(viaBearer.status).toBe(200);
    expect((await viaBearer.json() as ProbeBody).principal?.sub).toBe('glab-bot');
    // v4.public の Bearer はユーザ検証 (/api/auth/me) に回さない。
    expect(fakeFetch.mock.calls.some(([u]) => String(u).endsWith('/api/auth/me'))).toBe(false);
  });

  it.each([
    ['aud 違い', serviceClaims({ aud: 'someone-else' })],
    ['期限切れ', serviceClaims({ exp: new Date(Date.now() - 1000).toISOString() })],
    ['kind=user_for_project', serviceClaims({ kind: 'user_for_project' })],
  ])('%s の token は 401', async (_label, claims) => {
    start(true);
    const res = await makeApp().request('/api/x/consult/external/notifications', {
      headers: { 'x-glab-service-token': signPaseto(claims) },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid_service_token' });
  });

  it('別の鍵で署名された token は 401', async () => {
    start(true);
    const other = generateKeyPairSync('ed25519').privateKey;
    const res = await makeApp().request('/api/x/consult/external/notifications', {
      headers: { 'x-glab-service-token': signPaseto(serviceClaims(), other) },
    });
    expect(res.status).toBe(401);
  });

  it('外部経路以外に service token を送っても 401', async () => {
    start(true);
    const token = signPaseto(serviceClaims());
    const app = makeApp();
    const nonExternal = await app.request('/api/x/consult/list', {
      headers: { 'x-glab-service-token': token, authorization: `Bearer ${token}` },
    });
    expect(nonExternal.status).toBe(401);
    // 有効化していないモジュールの /external も対象外。
    const otherModule = await app.request('/api/x/other/external/notifications', {
      headers: { 'x-glab-service-token': token },
    });
    expect(otherModule.status).toBe(401);
  });

  it('無効化時は外部経路でも現行どおり 401', async () => {
    start(false);
    const res = await makeApp().request('/api/x/consult/external/notifications', {
      headers: { 'x-glab-service-token': signPaseto(serviceClaims()) },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('外部経路でも token が無ければ 401', async () => {
    start(true);
    const res = await makeApp().request('/api/x/consult/external/notifications');
    expect(res.status).toBe(401);
  });

  it('ユーザ token は外部経路でも外部経路以外でも従来どおりユーザとして通る', async () => {
    start(true);
    const app = makeApp();
    for (const path of ['/api/x/consult/external/notifications', '/api/x/consult/list']) {
      const res = await app.request(path, {
        headers: { authorization: `Bearer ${USER_TOKEN}`, 'x-glab-service-token': signPaseto(serviceClaims()) },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as ProbeBody;
      expect(body.userId).toBe('user-1');
      expect(body.userToken).toBe(USER_TOKEN);
      expect(body.principal).toBeNull();
    }
  });

  it('service 主体では requireAdmin が 401', async () => {
    start(true);
    const app = new Hono();
    app.use('/api/*', requireAuth);
    app.get('/api/x/consult/external/admin', requireAdmin, (c) => c.text('ok'));
    const res = await app.request('/api/x/consult/external/admin', {
      headers: { 'x-glab-service-token': signPaseto(serviceClaims()) },
    });
    expect(res.status).toBe(401);
  });
});

describe('readExternalServiceAuthConfig', () => {
  it('モジュール未指定なら無効 (null)', () => {
    expect(readExternalServiceAuthConfig({})).toBeNull();
    expect(readExternalServiceAuthConfig({ CORPUS_EXTERNAL_SERVICE_AUTH_MODULES: ' , ' })).toBeNull();
  });

  it('有効化時は storage_slug 必須', () => {
    expect(() => readExternalServiceAuthConfig({ CORPUS_EXTERNAL_SERVICE_AUTH_MODULES: 'consult' })).toThrow(
      /CORPUS_CERNERE_STORAGE_SLUG/,
    );
  });

  it('モジュール・ヘッダ名 (小文字化) ・ audience を読む', () => {
    const cfg = readExternalServiceAuthConfig({
      CORPUS_EXTERNAL_SERVICE_AUTH_MODULES: 'consult, projects',
      CORPUS_EXTERNAL_SERVICE_TOKEN_HEADERS: 'X-Glab-Service-Token,X-ProjectHub-Service-Token,Authorization',
      CORPUS_CERNERE_STORAGE_SLUG: ' educationlab ',
    });
    expect(cfg).toEqual({
      modules: new Set(['consult', 'projects']),
      headerNames: ['x-glab-service-token', 'x-projecthub-service-token'],
      audience: 'educationlab',
    });
  });
});

describe('matchExternalServiceRoute', () => {
  const modules = new Set(['consult']);
  it.each([
    ['/api/x/consult/external', 'consult'],
    ['/api/x/consult/external/notifications', 'consult'],
    ['/api/x/consult/externalx', null],
    ['/api/x/consult/list', null],
    ['/api/x/projects/external/a', null],
    ['/api/hub/external', null],
  ])('%s → %s', (path, expected) => {
    expect(matchExternalServiceRoute(path, modules)).toBe(expected);
  });
});

describe('decideServicePrincipal', () => {
  it('nbf が未来なら拒否する', () => {
    const now = Date.now();
    expect(decideServicePrincipal(serviceClaims({ nbf: new Date(now + 60_000).toISOString() }), AUDIENCE, now)).toBeNull();
  });

  it('scope が文字列配列でなければ拒否する', () => {
    expect(decideServicePrincipal(serviceClaims({ scope: 'glab-external:write' }), AUDIENCE, Date.now())).toBeNull();
  });
});
