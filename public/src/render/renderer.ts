// Corpus 宣言的レンダラ (Corpus DESIGN.md §13)。
//
// PanelDescriptor + RenderContext を受け取り、 8 component を DOM に描く。
// 描画先サービスに依存しない自己完結モジュール (§13.7)。

import type {
  ActionDescriptor,
  ComponentDescriptor,
  FormField,
  ListComponent,
  ListItemSpec,
  PanelDescriptor,
  RenderContext,
} from './types.ts';

// ── DOM / 値ヘルパ ──────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function getByPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function extractArray(json: unknown, itemsPath?: string): Record<string, unknown>[] {
  const v = itemsPath ? getByPath(json, itemsPath) : json;
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function applyFilter(raw: unknown, filter: string): string {
  if (raw == null || raw === '') return '';
  if (filter.startsWith('truncate:')) {
    const n = Number(filter.slice(9)) || 20;
    const s = String(raw);
    return s.length > n ? `${s.slice(0, n)}…` : s;
  }
  if (filter === 'number') return String(Number(raw));
  if (filter === 'datetime' || filter === 'date' || filter === 'time') {
    const d = new Date(typeof raw === 'number' ? raw : String(raw));
    if (Number.isNaN(d.getTime())) return String(raw);
    const ymd = `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
    const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    if (filter === 'date') return ymd;
    if (filter === 'time') return hm;
    return `${ymd} ${hm}`;
  }
  return String(raw);
}

/** `{field}` / `{field|filter}` をレコード値で置換。 */
function applyTemplate(tmpl: string, record: Record<string, unknown>): string {
  return tmpl.replace(/\{([^}|]+)(?:\|([^}]+))?\}/g, (_m, field: string, filter?: string) => {
    const raw = getByPath(record, field.trim());
    if (raw == null) return '';
    return filter ? applyFilter(raw, filter.trim()) : String(raw);
  });
}

function fillParams(
  spec: Record<string, string> | undefined,
  record: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(spec ?? {})) out[k] = applyTemplate(v, record);
  return out;
}

// ── アクション ──────────────────────────────────────────────────────────────

async function runAction(
  action: ActionDescriptor,
  record: Record<string, unknown>,
  ctx: RenderContext,
  toggledValue?: boolean,
): Promise<{ ok: boolean; message: string }> {
  if (action.confirm && !window.confirm(action.confirm)) {
    return { ok: false, message: '' };
  }
  const params = fillParams(action.params, record);
  let body: Record<string, unknown> | undefined;
  if (action.body) {
    body = {};
    for (const [k, v] of Object.entries(action.body)) {
      body[k] = v === '{toggled}' ? toggledValue === true : applyTemplate(v, record);
    }
  }
  try {
    const res = await ctx.data(action.dataId, { method: action.method, params, body });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, message: `失敗 (${res.status}) ${text}`.trim() };
    }
    return { ok: true, message: action.success ?? '完了しました' };
  } catch (e) {
    return { ok: false, message: `失敗: ${String(e)}` };
  }
}

function renderActionControl(
  action: ActionDescriptor,
  record: Record<string, unknown>,
  ctx: RenderContext,
  onDone: () => void,
  setStatus: (msg: string, ok: boolean) => void,
): HTMLElement | null {
  if (action.requires === 'admin' && !ctx.identity.isAdmin) return null;

  if (action.kind === 'toggle') {
    const label = el('label', 'corpus-toggle');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = action.state
      ? applyTemplate(action.state, record).toLowerCase() === 'true' ||
        applyTemplate(action.state, record) === '1'
      : false;
    cb.onchange = async () => {
      const r = await runAction(action, record, ctx, cb.checked);
      setStatus(r.message, r.ok);
      if (r.ok) onDone();
      else cb.checked = !cb.checked; // 失敗したら戻す
    };
    label.append(cb, document.createTextNode(action.label));
    return label;
  }

  const btn = el('button', 'corpus-btn ghost', action.label);
  btn.onclick = async () => {
    btn.disabled = true;
    const r = await runAction(action, record, ctx);
    setStatus(r.message, r.ok);
    btn.disabled = false;
    if (r.ok) onDone();
  };
  return btn;
}

// ── フォーム field ──────────────────────────────────────────────────────────

interface FieldControl {
  node: HTMLElement;
  value(): string;
  set(v: string): void;
}

function renderField(field: FormField, ctx: RenderContext): FieldControl {
  const wrap = el('label', 'corpus-field');
  wrap.appendChild(el('span', 'corpus-field-label', field.label));
  let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

  if (field.input === 'textarea') {
    input = el('textarea');
  } else if (field.input === 'select') {
    input = el('select');
  } else {
    const i = el('input');
    i.type = field.input === 'datetime' ? 'datetime-local'
      : field.input === 'date' ? 'date'
      : field.input === 'number' ? 'number'
      : field.input === 'checkbox' ? 'checkbox'
      : 'text';
    if (field.maxLength) i.maxLength = field.maxLength;
    input = i;
  }
  if (field.required) input.required = true;
  wrap.appendChild(input);

  const detailBox = el('div', 'corpus-field-detail');
  if (field.optionDetail) wrap.appendChild(detailBox);

  // select の選択肢を非同期ロード
  let optionRecords: Record<string, unknown>[] = [];
  if (field.input === 'select' && field.optionsSource) {
    const optionsSource = field.optionsSource;
    void (async () => {
      try {
        const res = await ctx.data(optionsSource);
        optionRecords = extractArray(await res.json(), field.optionsPath);
        const sel = input as HTMLSelectElement;
        sel.innerHTML = '';
        for (const rec of optionRecords) {
          const opt = el('option');
          opt.value = String(rec[field.optionValue ?? 'id'] ?? '');
          opt.textContent = String(rec[field.optionLabel ?? 'name'] ?? opt.value);
          sel.appendChild(opt);
        }
        renderOptionDetail();
      } catch {
        // 選択肢ロード失敗 — 空のまま
      }
    })();
  }

  function renderOptionDetail(): void {
    if (!field.optionDetail) return;
    const sel = input as HTMLSelectElement;
    const rec = optionRecords.find(
      (r) => String(r[field.optionValue ?? 'id']) === sel.value,
    );
    detailBox.innerHTML = '';
    if (!rec) return;
    for (const d of field.optionDetail) {
      detailBox.appendChild(
        el('span', 'corpus-tag', `${d.label}: ${applyTemplate(d.value, rec)}`),
      );
    }
  }
  if (field.input === 'select') input.addEventListener('change', renderOptionDetail);

  return {
    node: wrap,
    value: () =>
      input instanceof HTMLInputElement && input.type === 'checkbox'
        ? String(input.checked)
        : input.value,
    set: (v) => {
      if (input instanceof HTMLInputElement && input.type === 'checkbox') {
        input.checked = v === 'true';
      } else {
        input.value = v;
      }
    },
  };
}

// ── 各 component ────────────────────────────────────────────────────────────

function makeStatus(): { node: HTMLElement; set: (m: string, ok: boolean) => void } {
  const node = el('p', 'corpus-status');
  return {
    node,
    set: (m, ok) => {
      node.textContent = m;
      node.className = `corpus-status ${ok ? 'ok' : 'err'}`;
    },
  };
}

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
        method: 'PATCH',
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

function renderList(comp: ListComponent, ctx: RenderContext): HTMLElement {
  const root = el('div', 'corpus-list');
  const status = makeStatus();
  const body = el('div', 'corpus-list-body');
  root.append(body, status.node);
  const load = async (): Promise<void> => {
    body.innerHTML = '';
    let items: Record<string, unknown>[];
    try {
      const res = await ctx.data(comp.dataSource);
      items = extractArray(await res.json(), comp.itemsPath);
    } catch (e) {
      body.appendChild(el('p', 'corpus-error', `取得失敗: ${String(e)}`));
      return;
    }
    if (items.length === 0) {
      body.appendChild(el('p', 'corpus-empty', comp.empty ?? '(なし)'));
      return;
    }
    for (const item of items) {
      body.appendChild(renderListCard(comp, item, ctx, () => void load(), status.set));
    }
  };
  void load();
  return root;
}

function renderForm(comp: ComponentDescriptor & { type: 'form' }, ctx: RenderContext): HTMLElement {
  const wrap = el('div', 'corpus-form-wrap');
  const form = el('form', 'corpus-form');
  const status = makeStatus();
  const controls: { field: FormField; ctrl: FieldControl }[] = [];
  for (const field of comp.fields) {
    const ctrl = renderField(field, ctx);
    controls.push({ field, ctrl });
    form.appendChild(ctrl.node);
  }
  const submit = el('button', 'corpus-btn primary', '送信');
  form.appendChild(submit);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body: Record<string, unknown> = {};
    for (const { field, ctrl } of controls) body[field.name] = ctrl.value();
    submit.disabled = true;
    try {
      const res = await ctx.data(comp.submit.dataId, { method: comp.submit.method, body });
      if (!res.ok) {
        status.set(`失敗 (${res.status})`, false);
      } else {
        status.set(comp.submit.success ?? '送信しました', true);
        form.reset();
      }
    } catch (err) {
      status.set(`失敗: ${String(err)}`, false);
    } finally {
      submit.disabled = false;
    }
  };
  wrap.append(form, status.node);
  return wrap;
}

function renderDetail(
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

function renderTable(
  comp: ComponentDescriptor & { type: 'table' },
  ctx: RenderContext,
): HTMLElement {
  const root = el('div', 'corpus-table-wrap');
  const status = makeStatus();
  const tableHost = el('div');
  root.append(tableHost, status.node);
  const load = async (): Promise<void> => {
    tableHost.innerHTML = '';
    let rows: Record<string, unknown>[];
    try {
      const res = await ctx.data(comp.dataSource);
      rows = extractArray(await res.json(), comp.itemsPath);
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
  };
  void load();
  return root;
}

function renderStat(
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

function renderCustom(comp: ComponentDescriptor & { type: 'custom' }): HTMLElement {
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

// ── ディスパッチ ────────────────────────────────────────────────────────────

function renderComponent(
  comp: ComponentDescriptor,
  ctx: RenderContext,
): HTMLElement | null {
  if (comp.requires === 'admin' && !ctx.identity.isAdmin) return null;
  switch (comp.type) {
    case 'list':
      return renderList(comp, ctx);
    case 'form':
      return renderForm(comp, ctx);
    case 'detail':
      return renderDetail(comp, ctx);
    case 'table':
      return renderTable(comp, ctx);
    case 'stat':
      return renderStat(comp, ctx);
    case 'action-button': {
      const status = makeStatus();
      const wrap = el('div', 'corpus-action-wrap');
      const ctrl = renderActionControl(comp.action, {}, ctx, () => {}, status.set);
      if (ctrl) wrap.append(ctrl, status.node);
      return wrap;
    }
    case 'custom':
      return renderCustom(comp);
    case 'section': {
      const sec = el('div', 'corpus-subsection');
      if (comp.title) sec.appendChild(el('h4', 'corpus-subsection-title', comp.title));
      for (const child of comp.components) {
        const node = renderComponent(child, ctx);
        if (node) sec.appendChild(node);
      }
      return sec;
    }
    case 'tabs': {
      const wrap = el('div', 'corpus-tabs');
      const bar = el('div', 'corpus-tab-bar');
      const host = el('div', 'corpus-tab-host');
      wrap.append(bar, host);
      comp.tabs.forEach((tab, i) => {
        const btn = el('button', 'corpus-tab-btn', tab.label);
        btn.onclick = () => {
          host.innerHTML = '';
          for (const child of tab.components) {
            const node = renderComponent(child, ctx);
            if (node) host.appendChild(node);
          }
          for (const b of bar.children) b.classList.remove('active');
          btn.classList.add('active');
        };
        bar.appendChild(btn);
        if (i === 0) btn.click();
      });
      return wrap;
    }
  }
}

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
