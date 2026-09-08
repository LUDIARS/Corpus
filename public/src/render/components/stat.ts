// stat component (Corpus DESIGN.md §13.4-6)。
//
// dataSource から数値サマリ 1 つを表示する。 value 省略時は配列件数。

import type { ComponentDescriptor, RenderContext } from '../types.ts';
import { el } from '../internal/dom.ts';
import { applyTemplate, extractArray } from '../internal/template.ts';

export function renderStat(
  comp: ComponentDescriptor & { type: 'stat' },
  ctx: RenderContext,
): HTMLElement {
  const root = el('div', 'corpus-stat');
  root.appendChild(el('div', 'corpus-stat-label', comp.label));
  const valueNode = el('div', 'corpus-stat-value', '…');
  root.appendChild(valueNode);
  void (async () => {
    try {
      const res = await ctx.data(comp.dataSource);
      const json = await res.json();
      if (comp.value) {
        const rec = (typeof json === 'object' && json) as Record<string, unknown>;
        valueNode.textContent = applyTemplate(comp.value, rec || {});
      } else {
        valueNode.textContent = String(extractArray(json, comp.itemsPath).length);
      }
    } catch {
      valueNode.textContent = '—';
    }
  })();
  return root;
}
