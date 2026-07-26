// パネル共通の DOM ヘルパー。 パネルはフレームワーク非依存の素の TS で書き、
// esbuild で panel.js にバンドルする (Corpus shell が動的 import する)。

import type { PanelContext } from '../../public/src/types.ts';

export type { PanelContext };

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function section(title: string): HTMLElement {
  const wrap = el('section', 'corp-section');
  wrap.appendChild(el('h3', undefined, title));
  return wrap;
}

export function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 失敗時にパネルへメッセージを出す。 例外でパネル全体を白くしない。 */
export function showError(container: HTMLElement, message: string): void {
  container.appendChild(el('p', 'corp-error', `⚠️ ${message}`));
}

/** ctx.api の薄いラッパ。 非 2xx は null を返す (呼び出し側で degraded 表示)。 */
export async function getJson<T>(ctx: PanelContext, path: string): Promise<T | null> {
  const res = await ctx.api(path).catch(() => null);
  if (!res || !res.ok) return null;
  return await res.json().catch(() => null) as T | null;
}

let stylesInstalled = false;

/** パック共通のスタイル。 パネルごとに重複挿入しない。 */
export function ensureStyles(): void {
  if (stylesInstalled) return;
  const style = document.createElement('style');
  style.textContent = `
    .corp-section { margin-bottom: 1.5rem; }
    .corp-list { list-style: none; padding: 0; margin: 0; }
    .corp-item { padding: .6rem .8rem; border: 1px solid var(--border, #ddd);
                 border-radius: .5rem; margin-bottom: .5rem; }
    .corp-item.pinned { border-left-width: 4px; }
    .corp-meta { font-size: .8rem; opacity: .7; }
    .corp-error { color: #b00; }
    .corp-form { display: flex; flex-direction: column; gap: .5rem; max-width: 40rem; }
    .corp-form input, .corp-form textarea { padding: .5rem .6rem; border-radius: .5rem;
                 border: 1px solid var(--border, #ddd); font: inherit; }
  `;
  document.head.appendChild(style);
  stylesInstalled = true;
}
