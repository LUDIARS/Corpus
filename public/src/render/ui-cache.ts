// §15.4 Vite-P1: UI キー (declarative descriptor) の WebStorage キャッシュ。
//
// パネルを開いた時だけ uiEndpoint を取得し (= 遅延)、 取得した descriptor を
// ETag 付きで localStorage に保持する。 次回は If-None-Match で再検証し、
// 304 ならネットワーク本文 0 で再利用する (Vite の module キャッシュ相当)。
//
// 純関数として storage を差し替え可能にし、 単体テストできるようにする。

import type { PanelDescriptor } from './types.ts';

export interface CachedUi {
  /** サーバ (Corpus proxy) が content hash から発行した ETag。 */
  etag: string;
  descriptor: PanelDescriptor;
}

const PREFIX = 'corpus.ui.';

export function uiCacheKey(svcId: string, panelKey: string): string {
  return `${PREFIX}${svcId}.${panelKey}`;
}

/** 既定の Storage。 取得不能 (SSR / 無効化) は null。 */
function defaultStore(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readUiCache(
  svcId: string,
  panelKey: string,
  storage: Storage | null = defaultStore(),
): CachedUi | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(uiCacheKey(svcId, panelKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedUi>;
    if (
      typeof parsed.etag === 'string' &&
      parsed.descriptor != null &&
      typeof parsed.descriptor === 'object'
    ) {
      return { etag: parsed.etag, descriptor: parsed.descriptor as PanelDescriptor };
    }
    return null;
  } catch {
    return null; // 壊れた JSON は無視 (cache miss 扱い)
  }
}

export function writeUiCache(
  svcId: string,
  panelKey: string,
  entry: CachedUi,
  storage: Storage | null = defaultStore(),
): void {
  if (!storage) return;
  try {
    storage.setItem(uiCacheKey(svcId, panelKey), JSON.stringify(entry));
  } catch {
    // quota 超過 / serialize 失敗 → キャッシュは best-effort なので諦める。
  }
}

export function clearUiCache(
  svcId: string,
  panelKey: string,
  storage: Storage | null = defaultStore(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(uiCacheKey(svcId, panelKey));
  } catch {
    /* noop */
  }
}
