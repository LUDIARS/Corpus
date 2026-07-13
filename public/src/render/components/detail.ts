// detail component (Corpus DESIGN.md §13.4-3)。
//
// dataSource の 1 レコードを key-value (dl) で表示する。

import type { ComponentDescriptor, RenderContext } from '../types.ts';
import { el } from '../internal/dom.ts';
import { applyTemplate, getByPath } from '../internal/template.ts';

export function renderDetail(
  comp: ComponentDescriptor & { type: 'detail' },
  ctx: RenderContext,
): HTMLElement {
  const root = el('dl', 'corpus-detail');
  void (async () => {
    let record: Record<string, unknown> = {};
    try {
      const res = await ctx.data(comp.dataSource);
      const json = await res.json();
      const r = comp.recordPath ? getByPath(json, comp.recordPath) : json;
      if (r && typeof r === 'object') record = r as Record<string, unknown>;
    } catch (e) {
      root.appendChild(el('p', 'corpus-error', `取得失敗: ${String(e)}`));
      return;
    }
    for (const f of comp.fields) {
      root.appendChild(el('dt', undefined, f.label));
      root.appendChild(el('dd', undefined, applyTemplate(f.value, record)));
    }
  })();
  return root;
}
