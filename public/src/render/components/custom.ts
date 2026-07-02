// custom component (Corpus DESIGN.md §13.4-8、 エスケープハッチ)。
//
// サービス配信の Web Component を動的 import して mount する。

import type { ComponentDescriptor } from '../types.ts';
import { el } from '../internal/dom.ts';

export function renderCustom(comp: ComponentDescriptor & { type: 'custom' }): HTMLElement {
  const host = el('div', 'corpus-custom');
  void (async () => {
    try {
      await import(/* @vite-ignore */ comp.url);
      host.appendChild(document.createElement(comp.tag));
    } catch (e) {
      host.appendChild(el('p', 'corpus-error', `custom 読み込み失敗: ${String(e)}`));
    }
  })();
  return host;
}
