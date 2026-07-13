// Corpus 宣言的レンダラ (Corpus DESIGN.md §13) — 公開エントリ。
//
// PanelDescriptor + RenderContext を受け取り DOM に描く。
// 描画先サービスに依存しない自己完結モジュール (§13.7)。
//
// 実装は責務ごとに分割されている:
//   internal/   — dom / template 束縛 / action 実行 / form field / pagination
//   components/ — 各 ComponentDescriptor の描画 (list / form / table / dock 等)
//   dispatch.ts — type 分岐と admin ゲート
// vendor copy (各サービスの corpus-renderer/) はこのディレクトリ全体を同期する。

import type { PanelDescriptor, RenderContext } from './types.ts';
import { el } from './internal/dom.ts';
import { renderComponent } from './dispatch.ts';

/** descriptor を container に描く。 */
export function renderPanel(
  container: HTMLElement,
  descriptor: PanelDescriptor,
  ctx: RenderContext,
): void {
  container.innerHTML = '';
  container.appendChild(el('h2', 'corpus-panel-title', descriptor.title));
  for (const section of descriptor.sections) {
    const sec = el('section', 'corpus-section');
    if (section.title) {
      sec.appendChild(el('h3', 'corpus-section-title', section.title));
    }
    for (const comp of section.components) {
      const node = renderComponent(comp, ctx);
      if (node) sec.appendChild(node);
    }
    container.appendChild(sec);
  }
}
