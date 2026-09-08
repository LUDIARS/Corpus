// 静的テキスト (DESIGN.md §13.4-10)。データ取得を伴わず同期で描く。
import type { TextComponent } from '../types.ts';
import { el } from '../internal/dom.ts';

export function renderText(comp: TextComponent): HTMLElement {
  const tone = comp.tone ?? 'default';
  const cls = tone === 'default' ? 'corpus-text' : `corpus-text corpus-text--${tone}`;
  return el('p', cls, comp.value);
}
