// D5 — 認証トークンの伝播 (VantanHub-DESIGN.md §7)。
//
// Corpus が参照先サービスを叩く際、 どのトークンを送るかを抽象化する。
//  - passthrough          : 受信 Bearer をそのまま転送 (audience が揃う構成 /
//                           無認証ローカル直結向け)。 v0.2 の既定。
//  - cernere-project-token: 受信トークンを user accessToken とみなし、 Cernere
//                           /api/auth/project-token で参照先プロジェクト用の
//                           短命 PASETO を発行する (本番想定)。
//
// 発行済みトークンは process memory のみにキャッシュする
// ([[feedback_secret_per_user_memory_only]])。 disk / Infisical には残さない。

import { createHash } from 'node:crypto';

export interface DownstreamTarget {
  /** 参照先サービス id。 */
  service: string;
  /** Cernere managed project key (マニフェスト cernereProjectKey 由来)。 */
  projectKey: string;
  /**
   * 参照先サービスの baseUrl。 Cernere に `hub_url` として渡して PASETO の aud
   * claim を組み立てる (Issue #91 Phase 1)。 空文字なら旧 HS256 経路に fallback。
   */
  baseUrl: string;
}

export interface TokenProvider {
  readonly mode: string;
  /** 参照先へ送るトークンを返す。 取れなければ null。 */
  getDownstreamToken(
    incomingToken: string | null,
    target: DownstreamTarget,
  ): Promise<string | null>;
}

/** 受信 Bearer をそのまま転送する。 */
export class PassthroughTokenProvider implements TokenProvider {
  readonly mode = 'passthrough';
  async getDownstreamToken(
    incomingToken: string | null,
    _target: DownstreamTarget,
  ): Promise<string | null> {
    return incomingToken;
  }
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

/**
 * Cernere /api/auth/project-token で参照先ごとの短命 project token を発行する。
 * 受信トークンは「ログイン中ユーザの user accessToken」 である前提。
 */
export class CernereProjectTokenProvider implements TokenProvider {
  readonly mode = 'cernere-project-token';
  private readonly cache = new Map<string, CachedToken>();

  constructor(private readonly cernereBaseUrl: string) {}

  async getDownstreamToken(
    incomingToken: string | null,
    target: DownstreamTarget,
  ): Promise<string | null> {
    if (!incomingToken) return null;
    const key = `${tokenFingerprint(incomingToken)}:${target.projectKey}:${target.baseUrl}`;
    const cached = this.cache.get(key);
    // 30s の余裕を見て期限内ならキャッシュ利用
    if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;
    try {
      const reqBody: Record<string, string> = { project_key: target.projectKey };
      // hub_url を渡すと Cernere は PASETO v4 を mint する (Issue #91 Phase 1)。
      // 渡さないと HS256 fallback で、 PASETO 専用サービス (Bibliotheca 等) が
      // トークンを受け付けない。 baseUrl 空のコネクタは旧経路を踏む。
      if (target.baseUrl) reqBody.hub_url = target.baseUrl;
      const res = await fetch(`${this.cernereBaseUrl}/api/auth/project-token`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${incomingToken}`,
        },
        body: JSON.stringify(reqBody),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as {
        accessToken?: string;
        expiresIn?: number;
      };
      if (!body.accessToken) return null;
      const ttlMs = (body.expiresIn ?? 900) * 1000;
      this.cache.set(key, {
        token: body.accessToken,
        expiresAt: Date.now() + ttlMs,
      });
      return body.accessToken;
    } catch {
      return null;
    }
  }
}

/** 受信トークンを生のままキャッシュキーにしないための短い指紋。 */
function tokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

export type TokenMode = 'passthrough' | 'cernere-project-token';

/** env CORPUS_TOKEN_MODE から TokenProvider を組み立てる。 */
export function makeTokenProvider(
  mode: string | undefined,
  cernereBaseUrl: string,
): TokenProvider {
  if (mode === 'cernere-project-token') {
    return new CernereProjectTokenProvider(cernereBaseUrl.replace(/\/+$/, ''));
  }
  return new PassthroughTokenProvider();
}
