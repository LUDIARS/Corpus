// Cernere service token の受け側検証 (認証集約 P4 の Corpus 側、 spec/plan/auth-plane-consolidation.md §4.2)。
//
// 署名・kind・exp・aud (= ハブ自身の Cernere storage_slug) だけを見る。 scope は
// ここでは判定しない — 要求 scope は endpoint ごとに違うので、 プラグイン側が
// getServicePrincipal(c).scope で判定する。 呼出元名 (sub) でも分岐しない。
// 公開鍵は Cernere `/.well-known/cernere-public-key` から取り、 応答の max-age
// (600 秒) に合わせてメモリにキャッシュする (GLAB service-token-verifier.ts と同じ方針)。

import {
  pasetoFooterKid,
  verifyPasetoV4Public,
  type PasetoVerifyKey,
} from './paseto-v4-public.ts';

const KEY_CACHE_MS = 600_000;
/** 未知の kid を見たときの再取得は、 この間隔より頻繁にしない (偽 kid で Cernere を叩かせない)。 */
const KEY_REFRESH_MIN_INTERVAL_MS = 30_000;
const KEY_FETCH_TIMEOUT_MS = 5_000;
const SERVICE_TOKEN_PREFIX = 'v4.public.';

/** requireAuth が外部経路で通した service 呼び出しの主体。 */
export interface ServicePrincipal {
  kind: 'service';
  /** 呼出元の Cernere project 識別子。 認可の分岐には使わない (記録用)。 */
  sub: string;
  /** Cernere が付与した scope。 要求 scope の判定はプラグイン側で行う。 */
  scope: readonly string[];
}

export type ServiceTokenVerification =
  | { status: 'ok'; principal: ServicePrincipal }
  | { status: 'invalid' }
  | { status: 'unavailable' };

export interface ServiceTokenVerifier {
  verify(token: string): Promise<ServiceTokenVerification>;
}

/** PASETO v4.public の値だけを Cernere service token の候補として扱う。 */
export function isServiceTokenCandidate(token: string): boolean {
  return token.startsWith(SERVICE_TOKEN_PREFIX);
}

/**
 * 署名検証済みの claims から service 主体を決める。 kind / sub / scope の形・
 * exp (・nbf)・aud を見て、 崩れている・期限切れ・宛先違いは null。
 */
export function decideServicePrincipal(
  claims: Record<string, unknown>,
  audience: string,
  nowMs: number,
): ServicePrincipal | null {
  if (claims.kind !== 'service') return null;
  if (typeof claims.sub !== 'string' || !claims.sub) return null;
  if (!Array.isArray(claims.scope) || !claims.scope.every((s) => typeof s === 'string')) return null;
  if (!audience || claims.aud !== audience) return null;
  const exp = typeof claims.exp === 'string' ? Date.parse(claims.exp) : NaN;
  if (!Number.isFinite(exp) || exp <= nowMs) return null;
  const nbf = typeof claims.nbf === 'string' ? Date.parse(claims.nbf) : NaN;
  if (Number.isFinite(nbf) && nbf > nowMs) return null;
  return { kind: 'service', sub: claims.sub, scope: [...(claims.scope as string[])] };
}

export interface CernereServiceTokenVerifierOptions {
  cernereBaseUrl: string;
  /** ハブ自身の Cernere managed project の storage_slug (token の aud)。 */
  audience: string;
  fetch?: typeof fetch;
  now?: () => number;
}

export class CernereServiceTokenVerifier implements ServiceTokenVerifier {
  private readonly baseUrl: string;
  private readonly audience: string;
  private readonly fetchImpl: () => typeof fetch;
  private readonly now: () => number;
  private keys: PasetoVerifyKey[] | null = null;
  private fetchedAt = 0;
  private inFlight: Promise<PasetoVerifyKey[] | null> | null = null;

  constructor(options: CernereServiceTokenVerifierOptions) {
    this.baseUrl = options.cernereBaseUrl.trim().replace(/\/+$/, '');
    this.audience = options.audience.trim();
    this.fetchImpl = () => options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
  }

  async verify(token: string): Promise<ServiceTokenVerification> {
    if (!isServiceTokenCandidate(token)) return { status: 'invalid' };
    if (!this.baseUrl || !this.audience) return { status: 'unavailable' };
    let keys = await this.currentKeys(false);
    const kid = pasetoFooterKid(token);
    if (keys && kid && !keys.some((key) => key.kid === kid)) keys = await this.currentKeys(true);
    if (!keys) return { status: 'unavailable' };

    const claims = verifyPasetoV4Public(token, keys);
    if (!claims) return { status: 'invalid' };
    const principal = decideServicePrincipal(claims, this.audience, this.now());
    return principal ? { status: 'ok', principal } : { status: 'invalid' };
  }

  private async currentKeys(forceRefresh: boolean): Promise<PasetoVerifyKey[] | null> {
    const age = this.now() - this.fetchedAt;
    const fresh = this.keys && age < KEY_CACHE_MS;
    const mayRefresh = !this.keys || age >= KEY_REFRESH_MIN_INTERVAL_MS;
    if (fresh && !(forceRefresh && mayRefresh)) return this.keys;
    if (!mayRefresh) return this.keys;
    this.inFlight ??= this.fetchKeys().finally(() => { this.inFlight = null; });
    const fetched = await this.inFlight;
    // 取得に失敗しても、 期限内の既知鍵があれば使い続ける。
    return fetched ?? (fresh ? this.keys : null);
  }

  private async fetchKeys(): Promise<PasetoVerifyKey[] | null> {
    try {
      const response = await this.fetchImpl()(`${this.baseUrl}/.well-known/cernere-public-key`, {
        signal: AbortSignal.timeout(KEY_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const body = await response.json() as { keys?: Array<{ kid?: unknown; public_key?: unknown }> };
      const keys = (body.keys ?? []).flatMap((key) =>
        typeof key.kid === 'string' && typeof key.public_key === 'string'
          ? [{ kid: key.kid, publicKey: Buffer.from(key.public_key, 'base64') }]
          : []);
      if (keys.length === 0) return null;
      this.keys = keys;
      this.fetchedAt = this.now();
      return keys;
    } catch (e) {
      console.warn(`[auth] cernere public key fetch failed: ${(e as Error).message}`);
      return null;
    }
  }
}
