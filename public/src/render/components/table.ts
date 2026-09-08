// table component (Corpus DESIGN.md §13.4-4)。
//
// 列定義 + 行データの表描画と rowActions / pagination を担当する。

import type { RenderContext, TableComponent } from '../types.ts';
import { renderActionControl } from '../internal/actions.ts';
import { el, makeStatus } from '../internal/dom.ts';
import {
  type PaginationState,
  paginationParams,
  renderPaginationBar,
  updatePaginationState,
} from '../internal/pagination.ts';
import { applyTemplate, extractArray } from '../internal/template.ts';

export function renderTable(comp: TableComponent, ctx: RenderContext): HTMLElement {
  const root = el('div', 'corpus-table-wrap');
  const status = makeStatus();
  const tableHost = el('div');
  const paginationHost = el('div', 'corpus-pagination-host');
  root.append(tableHost, paginationHost, status.node);

  const spec = comp.pagination;
  const state: PaginationState = {
    page: spec?.startPage ?? 1,
    isLast: false,
    total: null,
  };

  const load = async (): Promise<void> => {
    tableHost.innerHTML = '';
    paginationHost.innerHTML = '';
    let json: unknown;
    let rows: Record<string, unknown>[];
    try {
      const opts = spec ? { params: paginationParams(spec, state.page) } : undefined;
      const res = await ctx.data(comp.dataSource, opts);
      json = await res.json();
      rows = extractArray(json, comp.itemsPath);
    } catch (e) {
      tableHost.appendChild(el('p', 'corpus-error', `取得失敗: ${String(e)}`));
      return;
    }
    const table = el('table', 'corpus-table');
    const thead = el('thead');
    const htr = el('tr');
    for (const col of comp.columns) htr.appendChild(el('th', undefined, col.header));
    const hasActions = (comp.rowActions ?? []).length > 0;
    if (hasActions) htr.appendChild(el('th'));
    thead.appendChild(htr);
    table.appendChild(thead);
    const tbody = el('tbody');
    for (const row of rows) {
      const tr = el('tr');
      for (const col of comp.columns) {
        tr.appendChild(el('td', undefined, applyTemplate(col.value, row)));
      }
      if (hasActions) {
        const td = el('td', 'corpus-row-actions');
        for (const action of comp.rowActions ?? []) {
          const ctrl = renderActionControl(action, row, ctx, () => void load(), status.set);
          if (ctrl) td.appendChild(ctrl);
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tableHost.appendChild(table);

    if (spec) {
      updatePaginationState(spec, state, json, rows.length);
      paginationHost.appendChild(renderPaginationBar(spec, state, (p) => {
        state.page = Math.max(spec.startPage ?? 1, p);
        void load();
      }));
    }
  };
  void load();
  return root;
}
