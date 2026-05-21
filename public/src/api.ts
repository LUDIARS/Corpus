// Corpus frontend の API クライアント。
//
// token は ?token= クエリ (Cernere リダイレクト直後) または localStorage から得る。
// 401 のときは Cernere ログインへ誘導する。

const TOKEN_KEY = 'corpus_token';

export function getToken(): string | null {
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
