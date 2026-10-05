// Cernere 認証 — Corpus は hub なので「user accessToken」 を保持する。
//
// 背景 (VantanHub-DESIGN.md §7 / D5):
//   Corpus は参照先サービスを叩く際、 参照先ごとの project-token を Cernere
//   `/api/auth/project-token` から発行する。 この発行 API は呼び出し元が
//   「ログイン中ユーザの user accessToken」 を持っていることを要求する。
//   よって Corpus は leaf サービス (project-token を public key で local 検証)
//   方式ではなく、 **user accessToken を受け取り、 Cernere `/api/auth/me` で
//   検証** する方式を採る。 検証結果は短時間キャッシュする。
//   保持した user accessToken は requireAuth が ctx に積み、 tokens.ts
//   (CernereProjectTokenProvider) が参照先トークン発行に使う。
//
// user accessToken は HS256 JWT で Cernere 秘密鍵でしか検証できないため、
// local 検証はできず Cernere への問い合わせが必要 — これは hub の性質上の
// 必然的なトレードオフ (leaf サービスの 6h 公開鍵 fetch より Cernere 密結合)。

import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createHash } from 'node:crypto';
import { resolveExternalId, type CorpusDb } from './db.ts';
import {
  extractServiceTokenCandidate,
  matchExternalServiceRoute,
  type ExternalServiceAuth,
} from './external-service-auth.ts';
import { isServiceTokenCandidate, type ServicePrincipal } from './service-token.ts';

/** 検証結果キャッシュの TTL。 user accessToken の寿命 (60min) より十分短く取る。 */
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface AuthIdentity {
  /** Cernere userId (sub)。 */
  userId: string;
  /** Corpus が解決した owner 識別子 (external-id、 案B)。 共有データの owner に使う。 */
  externalId: string;
  role: string;
  displayName: string | null;
  /** 旧 project-token 方式の名残。 現方式では常に null (互換のため残置)。 */
  projectKey: string | null;
  isAdmin: boolean;
}

interface AuthOptions {
  cernereBaseUrl: string;
  adminIds: ReadonlySet<string>;
  /** external-id 解決に使う SQLite ハンドル。 */
  db: CorpusDb;
  /** この Corpus が接続する Cernere の issuer 識別子。 */
  issuer: string;
  cookieSecure: boolean;
  /**
   * プラグイン外部経路 (/api/x/<moduleId>/external/*) で Cernere service token を
   * 受理する設定。 null / 未指定なら無効 (現行挙動)。
   */
  externalService?: ExternalServiceAuth | null;
}

export interface AuthTokenPair {
  accessToken: string;
  refreshToken: string;
}

interface CacheEntry {
  identity: AuthIdentity;
  expiresAt: number;
}

let optsRef: AuthOptions | null = null;
const cache = new Map<string, CacheEntry>();
const refreshInFlight = new Map<string, Promise<AuthTokenPair | null>>();
const ACCESS_COOKIE = 'cernere_token';
const REFRESH_COOKIE = 'cernere_refresh_token';
const ACCESS_COOKIE_MAX_AGE_SECONDS = 55 * 60;
const REFRESH_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function startAuth(opts: AuthOptions): () => void {
  optsRef = { ...opts, cernereBaseUrl: opts.cernereBaseUrl.replace(/\/+$/, '') };
  // 期限切れキャッシュの定期 sweep
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of cache) if (v.expiresAt <= now) cache.delete(k);
  }, CACHE_TTL_MS);
  timer.unref?.();
  return () => {
    clearInterval(timer);
    optsRef = null;
    cache.clear();
    refreshInFlight.clear();
  };
}

/** 生トークンをキャッシュキーにしないための短い指紋。 */
function fingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 24);
}

/**
 * user accessToken を Cernere `GET /api/auth/me` で検証して identity を得る。
 * 失敗 (不正トークン / Cernere 不達) は null。 結果は CACHE_TTL_MS キャッシュ。
 */
async function verifyToken(token: string): Promise<AuthIdentity | null> {
  if (!optsRef) return null;
  const owner = optsRef;
  const key = fingerprint(token);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.identity;
  try {
    const res = await fetch(`${owner.cernereBaseUrl}/api/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const u = (await res.json()) as {
      id?: string;
      name?: string;
      role?: string;
    };
    // shutdown / 再設定後は、 旧 optsRef の db / issuer を触らずに捨てる。
    if (!u.id || optsRef !== owner) return null;
    const identity: AuthIdentity = {
      userId: u.id,
      externalId: resolveExternalId(owner.db, owner.issuer, u.id),
      role: typeof u.role === 'string' ? u.role : 'general',
      displayName: typeof u.name === 'string' ? u.name : null,
      projectKey: null,
      isAdmin: owner.adminIds.has(u.id),
    };
    cache.set(key, { identity, expiresAt: Date.now() + CACHE_TTL_MS });
    return identity;
  } catch (e) {
    console.warn(`[auth] verify failed: ${(e as Error).message}`);
    return null;
  }
}

function extractBearerToken(c: Context): string | null {
  const h = c.req.header('authorization');
  if (h && h.toLowerCase().startsWith('bearer ')) return h.slice(7).trim();
  return null;
}

async function refreshAccessToken(refreshToken: string): Promise<AuthTokenPair | null> {
  if (!optsRef) return null;
  const key = fingerprint(refreshToken);
  const existing = refreshInFlight.get(key);
  if (existing) return existing;
  const request = (async (): Promise<AuthTokenPair | null> => {
    try {
      const response = await fetch(`${optsRef?.cernereBaseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) return null;
      const body = await response.json() as Partial<AuthTokenPair>;
      if (typeof body.accessToken !== 'string' || typeof body.refreshToken !== 'string') {
        return null;
      }
      return { accessToken: body.accessToken, refreshToken: body.refreshToken };
    } catch {
      return null;
    }
  })().finally(() => refreshInFlight.delete(key));
  refreshInFlight.set(key, request);
  return request;
}

export function persistAuthCookies(c: Context, tokens: AuthTokenPair): void {
  const secure = optsRef?.cookieSecure ?? false;
  setCookie(c, ACCESS_COOKIE, tokens.accessToken, {
    httpOnly: true,
    sameSite: 'Lax',
    secure,
    path: '/',
    maxAge: ACCESS_COOKIE_MAX_AGE_SECONDS,
  });
  setCookie(c, REFRESH_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    sameSite: 'Lax',
    secure,
    path: '/',
    maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS,
  });
}

export function clearAuthCookies(c: Context): void {
  const options = { path: '/', secure: optsRef?.cookieSecure ?? false };
  deleteCookie(c, ACCESS_COOKIE, options);
  deleteCookie(c, REFRESH_COOKIE, options);
}

export function getRefreshToken(c: Context): string | null {
  return getCookie(c, REFRESH_COOKIE) ?? null;
}

/** --no-cernere / CORPUS_NO_AUTH=1 のとき requireAuth が返す固定 identity。
 *  ローカルデバッグ専用 — 本番運用では絶対に CORPUS_NO_AUTH を立てない。 */
const NO_AUTH_IDENTITY: AuthIdentity = {
  userId: 'dev-user',
  externalId: 'dev-user',
  role: 'admin',
  displayName: 'Dev User (CORPUS_NO_AUTH)',
  projectKey: null,
  isAdmin: true,
};

type UserAuthResult =
  | { ok: true; token: string; identity: AuthIdentity }
  | { ok: false; error: 'unauthorized' | 'invalid_token' };

/**
 * ユーザ token (Bearer → cookie → refresh cookie) を検証する。 bearerToken は
 * ユーザ token として扱う Bearer 値 (無ければ null)。
 */
async function resolveUserAuth(c: Context, bearerToken: string | null): Promise<UserAuthResult> {
  let token = bearerToken ?? getCookie(c, ACCESS_COOKIE) ?? null;
  let identity = token ? await verifyToken(token) : null;
  if (!identity && !bearerToken) {
    const refreshToken = getRefreshToken(c);
    const refreshed = refreshToken ? await refreshAccessToken(refreshToken) : null;
    if (refreshed) {
      persistAuthCookies(c, refreshed);
      token = refreshed.accessToken;
      identity = await verifyToken(token);
    } else if (refreshToken) {
      clearAuthCookies(c);
    }
  }
  if (!token) return { ok: false, error: 'unauthorized' };
  if (!identity) return { ok: false, error: 'invalid_token' };
  return { ok: true, token, identity };
}

/**
 * 外部経路 (有効化済みモジュールの /api/x/<moduleId>/external/*) の認証。
 * 有効なユーザ token があれば従来どおりユーザとして通し、 無ければ Cernere service
 * token (署名・kind・exp・aud) を検証して service 主体を積む。 scope はプラグイン側が見る。
 * user accessToken は PASETO ではないので、 `v4.public.` の Bearer はユーザ検証に回さない。
 */
async function authenticateExternalRoute(
  c: Context,
  external: ExternalServiceAuth,
): Promise<UserAuthResult | { ok: true; principal: ServicePrincipal } | { ok: false; status: 401 | 503; error: string }> {
  const bearer = extractBearerToken(c);
  const userBearer = bearer && !isServiceTokenCandidate(bearer) ? bearer : null;
  const user = await resolveUserAuth(c, userBearer);
  if (user.ok) return user;
  const serviceToken = extractServiceTokenCandidate(c, external.headerNames);
  if (!serviceToken) return user;
  const verification = await external.verifier.verify(serviceToken);
  switch (verification.status) {
    case 'ok': return { ok: true, principal: verification.principal };
    case 'invalid': return { ok: false, status: 401, error: 'invalid_service_token' };
    case 'unavailable': return { ok: false, status: 503, error: 'service_token_verifier_unavailable' };
  }
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
  if (process.env.CORPUS_NO_AUTH === '1') {
    // 認証 bypass — UI / hub の動作確認用。 downstream service への参照先
    // トークン発行は機能しない (userToken が空) ので、 services への
    // 実データ取得は別途 noauth 設定された service でないと 401 になる。
    c.set('auth', NO_AUTH_IDENTITY);
    c.set('userToken', '');
    await next();
    return;
  }
  const external = optsRef?.externalService ?? null;
  const result = external && matchExternalServiceRoute(c.req.path, external.modules)
    ? await authenticateExternalRoute(c, external)
    : await resolveUserAuth(c, extractBearerToken(c));
  if (!result.ok) {
    return c.json({ error: result.error }, 'status' in result ? result.status : 401);
  }
  if ('principal' in result) {
    // service 主体: auth / userToken は積まない (getIdentity は例外、 getUserToken は null)。
    c.set('servicePrincipal', result.principal);
  } else {
    c.set('auth', result.identity);
    // D5: 参照先トークン発行 (tokens.ts) で使う user accessToken を ctx に積む。
    c.set('userToken', result.token);
  }
  await next();
};

export const requireAdmin: MiddlewareHandler = async (c, next) => {
  const id = c.get('auth') as AuthIdentity | undefined;
  if (!id) return c.json({ error: 'unauthorized' }, 401);
  if (!id.isAdmin) return c.json({ error: 'admin_required' }, 403);
  await next();
};

export function getIdentity(c: Context): AuthIdentity {
  const id = c.get('auth') as AuthIdentity | undefined;
  if (!id) {
    if (c.get('servicePrincipal')) {
      throw new Error('auth identity missing — request is authenticated as a service principal');
    }
    throw new Error('auth identity missing — requireAuth not mounted');
  }
  return id;
}

/**
 * 外部経路で requireAuth が通した service 主体 (ユーザ認証のリクエストでは null)。
 * プラグインは scope をここから読んで endpoint ごとの認可を行う。
 */
export function getServicePrincipal(c: Context): ServicePrincipal | null {
  return (c.get('servicePrincipal') as ServicePrincipal | undefined) ?? null;
}

/** requireAuth が積んだ user accessToken を取り出す (参照先トークン発行用)。 */
export function getUserToken(c: Context): string | null {
  return (c.get('userToken') as string | undefined) ?? null;
}

declare module 'hono' {
  interface ContextVariableMap {
    auth: AuthIdentity;
    userToken: string;
    servicePrincipal: ServicePrincipal;
  }
}

export async function _testOnlyVerify(
  token: string,
): Promise<AuthIdentity | null> {
  return verifyToken(token);
}
