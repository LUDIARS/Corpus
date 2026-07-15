// Corpus frontend の API クライアント。
//
// 認証情報は Corpus origin の HttpOnly Cookie で保持する。ブラウザ JavaScript は
// access / refresh token を読まず、同一 origin fetch で Cookie を送るだけにする。

const TOKEN_KEY = 'corpus_token';

export function clearLegacyToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class AuthError extends Error {
  constructor() {
    super('unauthorized');
    this.name = 'AuthError';
  }
}

/** HttpOnly Cookie付きで fetch する。401 なら AuthError を投げる。 */
export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const res = await fetch(path, { ...init, credentials: 'same-origin' });
  if (res.status === 401) throw new AuthError();
  return res;
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}
