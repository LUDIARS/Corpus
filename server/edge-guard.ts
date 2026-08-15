// Cloudflare Access エッジ配置の設定不備ガード (DESIGN.md §16.6 / §16.5)。
//
// これは**認証ではない**。 Hub は受け取ったアサーションの署名を検証せず、 信頼判断は
// Cernere (`auth.edge_assertion`) が行う。 ここが担うのは「Cloudflare Access が
// 前段に居ない状態で origin が晒されている」 という構成事故を、 誰かが踏んだ瞬間に
// 検知して落とすことだけである。
//
// なぜ検証まで踏み込まないか: origin へ直接到達できる経路が残っている限り、 攻撃者は
// ヘッダを自分で付けられる (DESIGN §16.3)。 したがってヘッダの有無を見ても、 見た上で
// 署名まで検証しても、 「直接到達できない」 という構成上の前提を Corpus 側で肩代わり
// することはできない。 強固な認証が要る場面は Cernere 側の経路で行う。
//
// SRP: env の解釈と 1 本の middleware だけ。 Cernere 往復も Cookie 発行も持たない。

import type { Context, MiddlewareHandler } from 'hono';

/** CF Access が origin へ付与する署名付きアサーション。 署名の無い Email ヘッダは使わない。 */
export const EDGE_ASSERTION_HEADER = 'cf-access-jwt-assertion';

export type CorpusAuthMode = 'composite' | 'edge';

/**
 * ガードを外れてよい経路。 health は Excubitor が loopback から直接叩くため、
 * ここを塞ぐと Cloudflare 経由でないという理由でサービスが死んで見える。
 */
const GUARD_EXEMPT_PATHS = new Set(['/api/health']);

/** `CORPUS_AUTH_MODE` を解釈する。 未設定・空白・未知の値は null を返す。 */
export function parseAuthMode(raw: string | undefined): CorpusAuthMode | null {
  const value = raw?.trim();
  if (value === 'composite' || value === 'edge') return value;
  return null;
}

export interface EdgeDevIdentityCheck {
  /** dev バイパスを許可してよいか。 */
  allowed: boolean;
  /** 拒否理由 (allowed=false かつ値が設定されているときのみ)。 */
  reason?: string;
}

/** loopback を指す URL か。 判定できない文字列は loopback でないものとして扱う。 */
function isLoopbackUrl(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }
  const host = hostname.replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/**
 * `CORPUS_EDGE_DEV_IDENTITY` を使ってよいかを判定する (DESIGN §16.5)。
 *
 * 開発用バイパスを本番設定へ置き忘れる事故がこのガードの主対象なので、 判定は
 * 起動時に行い、 危険なら起動を拒否する。 実行中に効く条件にすると、 事故が
 * 「動いてしまってから」 しか分からない。
 *
 * §16.5 は listen が loopback であることを条件に置いているが、 Corpus の
 * listen host は現状 env で制御できない。 代わりに公開 URL (`CORPUS_PUBLIC_URL`)
 * が loopback を指していることを条件にする。 実運用の Hub は必ず公開 URL を
 * 持つため、 意図としては同じものを見ている。
 */
export function checkEdgeDevIdentity(params: {
  value: string | undefined;
  nodeEnv: string | undefined;
  publicUrl: string;
}): EdgeDevIdentityCheck {
  const value = params.value?.trim();
  if (!value) return { allowed: false };
  if (params.nodeEnv === 'production') {
    return { allowed: false, reason: 'NODE_ENV=production では使用できません' };
  }
  if (!isLoopbackUrl(params.publicUrl)) {
    return {
      allowed: false,
      reason: `CORPUS_PUBLIC_URL (${params.publicUrl}) が loopback を指していません`,
    };
  }
  return { allowed: true };
}

export interface EdgeHeaderGuardOptions {
  /** dev バイパスが有効か。 checkEdgeDevIdentity の判定結果を渡す。 */
  devBypass: boolean;
}

/**
 * `Cf-Access-Jwt-Assertion` を持たないリクエストを 401 で落とす。
 *
 * 値の中身は一切見ない。 ここで署名を検証しても §16.3 の前提は肩代わりできず、
 * 「検証済み」 という誤った安心を与えるだけなので、 あえて presence だけを見る。
 */
export function makeEdgeHeaderGuard(options: EdgeHeaderGuardOptions): MiddlewareHandler {
  return async (c: Context, next) => {
    if (options.devBypass) return next();
    if (GUARD_EXEMPT_PATHS.has(c.req.path)) return next();
    const assertion = c.req.header(EDGE_ASSERTION_HEADER);
    if (assertion && assertion.trim()) return next();
    return c.json(
      {
        error: 'edge_assertion_missing',
        message: 'Cloudflare Access 経由でアクセスしてください。',
      },
      401,
    );
  };
}
