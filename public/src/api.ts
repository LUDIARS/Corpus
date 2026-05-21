// Corpus frontend の API クライアント。
//
// token は Cernere の user accessToken。 Cernere SSO リダイレクト直後の
// #token= ハッシュ (または ?token= クエリ) から取り込み、 localStorage に保持する。
// Corpus サーバはこれを /api/auth/me で検証し、 参照先トークン発行にも使う。
// 401 のときは Cernere ログインへ誘導する。

const TOKEN_KEY = 'corpus_token';

export function getToken(): string | null {
  // Cernere SSO リダイレクトは #token= ハッシュで返す
  const hashMatch = location.hash.match(/token=([^&]+)/);
  if (hashMatch && hashMatch[1]) {
    const tok = decodeURIComponent(hashMatch[1]);
    localStorage.setItem(TOKEN_KEY, tok);
    history.replaceState(null, '', location.pathname + location.search);
    return tok;
  }
  // 一部フローは ?token= クエリ
  const url = new URL(location.href);
  const fromQuery = url.searchParams.get('token');
  if (fromQuery) {
    localStorage.setItem(TOKEN_KEY, fromQuery);
    url.searchParams.delete('token');
    history.replaceState(null, '', url.toString());
    return fromQuery;
  }
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class AuthError extends Error {
  constructor() {
    super('unauthorized');
    this.name = 'AuthError';
  }
}

/** Authorization ヘッダ付きで fetch する。 401 なら AuthError を投げる。 */
export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) throw new AuthError();
  return res;
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

/** Cernere ログインへリダイレクトする。 */
export async function loginRedirect(): Promise<void> {
  try {
    const res = await fetch('/api/public-config');
    const cfg = (await res.json()) as { cernereBaseUrl?: string };
    const base = (cfg.cernereBaseUrl ?? '').replace(/\/+$/, '');
    const back = encodeURIComponent(location.origin + location.pathname);
    location.href = `${base}/auth?redirect=${back}`;
  } catch {
    alert('Cernere の設定取得に失敗しました。');
  }
}
