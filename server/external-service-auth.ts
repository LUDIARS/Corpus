// プラグイン外部経路 (/api/x/<moduleId>/external/*) の service token 受理設定 (認証集約 P4)。
//
// ユーザ token を持たないサービス呼び出し (GLAB bot / Calliope 等) を、 プラグイン側の
// service 認可に届く前に requireAuth が 401 で落とさないための口。 ハブの起動設定で
// モジュール単位に opt-in した場合だけ働き、 既定は無効 (= 現行挙動のまま)。
//
// env:
//   CORPUS_EXTERNAL_SERVICE_AUTH_MODULES  有効化する moduleId のカンマ区切り (未設定/空 = 無効)
//   CORPUS_EXTERNAL_SERVICE_TOKEN_HEADERS service token を探すヘッダ名のカンマ区切り
//                                         (Authorization: Bearer は常に見る)
//   CORPUS_CERNERE_STORAGE_SLUG           ハブ自身の Cernere storage_slug (token の aud)。 有効化時は必須

import type { Context } from 'hono';
import { isServiceTokenCandidate, type ServiceTokenVerifier } from './service-token.ts';

export interface ExternalServiceAuthConfig {
  modules: ReadonlySet<string>;
  /** 小文字化済みのヘッダ名。 */
  headerNames: readonly string[];
  /** service token の aud と照合するハブ自身の storage_slug。 */
  audience: string;
}

/** requireAuth に渡す外部経路の受理設定 (設定 + 検証器)。 */
export interface ExternalServiceAuth {
  modules: ReadonlySet<string>;
  headerNames: readonly string[];
  verifier: ServiceTokenVerifier;
}

function splitList(value: string | undefined): string[] {
  return (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * env から外部経路の受理設定を読む。 モジュール未指定なら null (無効)。
 * 有効化したのに storage_slug が無い場合は、 無言で無効化せず起動を止める (RULE §7.1)。
 */
export function readExternalServiceAuthConfig(
  env: Record<string, string | undefined>,
): ExternalServiceAuthConfig | null {
  const modules = splitList(env.CORPUS_EXTERNAL_SERVICE_AUTH_MODULES);
  if (modules.length === 0) return null;
  const audience = env.CORPUS_CERNERE_STORAGE_SLUG?.trim() ?? '';
  if (!audience) {
    throw new Error(
      'CORPUS_EXTERNAL_SERVICE_AUTH_MODULES を設定した場合は CORPUS_CERNERE_STORAGE_SLUG (ハブ自身の Cernere storage_slug) が必須です',
    );
  }
  const headerNames = splitList(env.CORPUS_EXTERNAL_SERVICE_TOKEN_HEADERS)
    .map((h) => h.toLowerCase())
    .filter((h) => h !== 'authorization');
  return { modules: new Set(modules), headerNames: [...new Set(headerNames)], audience };
}

const EXTERNAL_ROUTE = /^\/api\/x\/([^/]+)\/external(?:\/|$)/;

/** 有効化されたモジュールの外部経路なら moduleId、 それ以外は null。 */
export function matchExternalServiceRoute(
  path: string,
  modules: ReadonlySet<string>,
): string | null {
  const moduleId = EXTERNAL_ROUTE.exec(path)?.[1];
  return moduleId && modules.has(moduleId) ? moduleId : null;
}

/**
 * service token の候補を探す。 設定ヘッダ (設定順) → Authorization: Bearer の順で、
 * 値が `v4.public.` で始まる最初のものを返す。 固定トークン等の非 PASETO 値は候補にしない。
 */
export function extractServiceTokenCandidate(
  c: Context,
  headerNames: readonly string[],
): string | null {
  for (const name of headerNames) {
    const value = c.req.header(name)?.trim();
    if (value && isServiceTokenCandidate(value)) return value;
  }
  const auth = c.req.header('authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    const value = auth.slice(7).trim();
    if (isServiceTokenCandidate(value)) return value;
  }
  return null;
}
