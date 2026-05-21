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
import { createHash } from 'node:crypto';

/** 検証結果キャッシュの TTL。 user accessToken の寿命 (60min) より十分短く取る。 */
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface AuthIdentity {
  /** Cernere userId (sub)。 */
  userId: string;
  role: string;
  displayName: string | null;
  /** 旧 project-token 方式の名残。 現方式では常に null (互換のため残置)。 */
  projectKey: string | null;
  isAdmin: boolean;
}

interface AuthOptions {
  cernereBaseUrl: string;
  adminIds: ReadonlySet<string>;
}

interface CacheEntry {
  identity: AuthIdentity;
  expiresAt: number;
}

let optsRef: AuthOptions | null = null;
const cache = new Map<string, CacheEntry>();

export function startAuth(opts: AuthOptions): void {
  optsRef = { ...opts, cernereBaseUrl: opts.cernereBaseUrl.replace(/\/+$/, '') };
  // 期限切れキャッシュの定期 sweep
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of cache) if (v.expiresAt <= now) cache.delete(k);
  }, CACHE_TTL_MS);
  timer.unref?.();
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
  const key = fingerprint(token);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.identity;
  try {
    const res = await fetch(`${optsRef.cernereBaseUrl}/api/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const u = (await res.json()) as {
      id?: string;
      name?: string;
      role?: string;
    };
    if (!u.id) return null;
    const identity: AuthIdentity = {
      userId: u.id,
      role: typeof u.role === 'string' ? u.role : 'general',
      displayName: typeof u.name === 'string' ? u.name : null,
      projectKey: null,
      isAdmin: optsRef.adminIds.has(u.id),
    };
    cache.set(key, { identity, expiresAt: Date.now() + CACHE_TTL_MS });
    return identity;
  } catch (e) {
    console.warn(`[auth] verify failed: ${(e as Error).message}`);
    return null;
  }
}

function extractToken(c: Context): string | null {
  const h = c.req.header('authorization');
  if (h && h.toLowerCase().startsWith('bearer ')) return h.slice(7).trim();
  // SSO リダイレクト直後など cookie 経由のフォールバックも許可する。
  const cookie = c.req.header('cookie') ?? '';
  const m = cookie.match(/(?:^|;\s*)cernere_token=([^;]+)/);
  return m && m[1] ? decodeURIComponent(m[1]) : null;
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const token = extractToken(c);
  if (!token) return c.json({ error: 'unauthorized' }, 401);
  const identity = await verifyToken(token);
  if (!identity) return c.json({ error: 'invalid_token' }, 401);
  c.set('auth', identity);
  // D5: 参照先トークン発行 (tokens.ts) で使う user accessToken を ctx に積む。
  c.set('userToken', token);
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
  if (!id) throw new Error('auth identity missing — requireAuth not mounted');
  return id;
}

/** requireAuth が積んだ user accessToken を取り出す (参照先トークン発行用)。 */
export function getUserToken(c: Context): string | null {
  return (c.get('userToken') as string | undefined) ?? null;
}

declare module 'hono' {
  interface ContextVariableMap {
    auth: AuthIdentity;
    userToken: string;
  }
}

export async function _testOnlyVerify(
  token: string,
): Promise<AuthIdentity | null> {
  return verifyToken(token);
}
