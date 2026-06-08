import { describe, it, expect } from 'vitest';
import { readUiCache, writeUiCache, clearUiCache, uiCacheKey } from './ui-cache.ts';
import type { PanelDescriptor } from './types.ts';

/** Map ベースの最小 Storage (jsdom 非依存でキャッシュ挙動を検証する)。 */
function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, v),
  } as Storage;
}

const desc: PanelDescriptor = { descriptorVersion: 1, title: 'P', sections: [] } as PanelDescriptor;

describe('ui-cache', () => {
  it('uiCacheKey は service / panel を含む安定キーを作る', () => {
    expect(uiCacheKey('cernere', 'account')).toBe('corpus.ui.cernere.account');
  });

  it('write → read で etag + descriptor を往復できる', () => {
    const s = fakeStorage();
    writeUiCache('cernere', 'account', { etag: '"abc"', descriptor: desc }, s);
    const got = readUiCache('cernere', 'account', s);
    expect(got).not.toBeNull();
    expect(got?.etag).toBe('"abc"');
    expect(got?.descriptor.title).toBe('P');
  });

  it('未保存キーは null', () => {
    expect(readUiCache('x', 'y', fakeStorage())).toBeNull();
  });

  it('壊れた JSON は null (cache miss 扱い)', () => {
    const s = fakeStorage();
    s.setItem(uiCacheKey('cernere', 'account'), '{not json');
    expect(readUiCache('cernere', 'account', s)).toBeNull();
  });

  it('etag 欠落の不正な形は null', () => {
    const s = fakeStorage();
    s.setItem(uiCacheKey('cernere', 'account'), JSON.stringify({ descriptor: desc }));
    expect(readUiCache('cernere', 'account', s)).toBeNull();
  });

  it('clear で削除できる', () => {
    const s = fakeStorage();
    writeUiCache('cernere', 'account', { etag: '"abc"', descriptor: desc }, s);
    clearUiCache('cernere', 'account', s);
    expect(readUiCache('cernere', 'account', s)).toBeNull();
  });

  it('storage=null でも例外を投げない (SSR / 無効環境)', () => {
    expect(() => writeUiCache('a', 'b', { etag: '"e"', descriptor: desc }, null)).not.toThrow();
    expect(readUiCache('a', 'b', null)).toBeNull();
  });
});
