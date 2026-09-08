// list component (Corpus DESIGN.md §13.4-1)。
//
// dataSource の配列を card で並べる。 item action / インライン編集 (item.edit) /
// pagination を含む一覧描画のみを担当する。

import type { FormField, ListComponent, ListItemSpec, RenderContext } from '../types.ts';
import { renderActionControl } from '../internal/actions.ts';
import { el, makeStatus } from '../internal/dom.ts';
import { type FieldControl, renderField } from '../internal/fields.ts';
import {
  type PaginationState,
  paginationParams,
  renderPaginationBar,
  updatePaginationState,
} from '../internal/pagination.ts';
import { applyTemplate, extractArray, fillParams, getByPath } from '../internal/template.ts';

function renderListCard(
  comp: ListComponent,
  item: Record<string, unknown>,
  ctx: RenderContext,
  reload: () => void,
  setStatus: (m: string, ok: boolean) => void,
): HTMLElement {
  const card = el('div', 'corpus-card');
  const spec: ListItemSpec = comp.item;
  card.appendChild(el('div', 'corpus-card-title', applyTemplate(spec.title, item)));
  if (spec.subtitle) {
    card.appendChild(el('div', 'corpus-card-sub', applyTemplate(spec.subtitle, item)));
  }
  if (spec.body) {
    card.appendChild(el('div', 'corpus-card-body', applyTemplate(spec.body, item)));
  }
  if (spec.meta) {
    card.appendChild(el('div', 'corpus-card-meta', applyTemplate(spec.meta, item)));
  }
  const actions = el('div', 'corpus-card-actions');
  for (const action of spec.actions ?? []) {
    const ctrl = renderActionControl(action, item, ctx, reload, setStatus);
    if (ctrl) actions.appendChild(ctrl);
  }
  if (spec.edit) {
    const editBtn = el('button', 'corpus-btn ghost', '編集');
    editBtn.onclick = () => card.replaceWith(renderEditForm(comp, item, ctx, reload, setStatus));
    actions.appendChild(editBtn);
  }
  if (actions.childElementCount > 0) card.appendChild(actions);
  return card;
}

function renderEditForm(
  comp: ListComponent,
  item: Record<string, unknown>,
  ctx: RenderContext,
  reload: () => void,
  setStatus: (m: string, ok: boolean) => void,
): HTMLElement {
  const edit = comp.item.edit;
  const form = el('form', 'corpus-edit-form');
  if (!edit) return form;
  const controls: { field: FormField; ctrl: FieldControl }[] = [];
  for (const field of edit.fields) {
    const ctrl = renderField(field, ctx);
    const raw = getByPath(item, field.name);
    if (raw != null) ctrl.set(String(raw));
    controls.push({ field, ctrl });
    form.appendChild(ctrl.node);
  }
  const save = el('button', 'corpus-btn primary', '保存');
  const cancel = el('button', 'corpus-btn ghost', '取消');
  cancel.type = 'button';
  cancel.onclick = () => reload();
  form.append(save, cancel);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body: Record<string, unknown> = {};
    for (const { field, ctrl } of controls) body[field.name] = ctrl.value();
    try {
      const res = await ctx.data(edit.dataId, {
        method: edit.method,
        params: fillParams(edit.params, item),
        body,
      });
      if (!res.ok) {
        setStatus(`更新失敗 (${res.status})`, false);
        return;
      }
      setStatus(edit.success ?? '更新しました', true);
      reload();
    } catch (err) {
      setStatus(`更新失敗: ${String(err)}`, false);
    }
  };
  return form;
}

export function renderList(comp: ListComponent, ctx: RenderContext): HTMLElement {
  const root = el('div', 'corpus-list');
  const status = makeStatus();
  const body = el('div', 'corpus-list-body');
  const paginationHost = el('div', 'corpus-pagination-host');
  root.append(body, paginationHost, status.node);

  const spec = comp.pagination;
  const state: PaginationState = {
    page: spec?.startPage ?? 1,
    isLast: false,
    total: null,
  };

  const load = async (): Promise<void> => {
    body.innerHTML = '';
    paginationHost.innerHTML = '';
    let json: unknown;
    let items: Record<string, unknown>[];
    try {
      const opts = spec ? { params: paginationParams(spec, state.page) } : undefined;
      const res = await ctx.data(comp.dataSource, opts);
      json = await res.json();
      items = extractArray(json, comp.itemsPath);
    } catch (e) {
      body.appendChild(el('p', 'corpus-error', `取得失敗: ${String(e)}`));
      return;
    }
    if (items.length === 0 && state.page === (spec?.startPage ?? 1)) {
      body.appendChild(el('p', 'corpus-empty', comp.empty ?? '(なし)'));
    }
    for (const item of items) {
      body.appendChild(renderListCard(comp, item, ctx, () => void load(), status.set));
    }
    if (spec) {
      updatePaginationState(spec, state, json, items.length);
      paginationHost.appendChild(renderPaginationBar(spec, state, (p) => {
        state.page = Math.max(spec.startPage ?? 1, p);
        void load();
      }));
    }
  };
  void load();
  return root;
}
