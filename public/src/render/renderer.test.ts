// @vitest-environment jsdom
//
// corpus-renderer (DESIGN.md §13) の振る舞いを DOM 上で検証する.
// ctx.data は vi.fn() で Response を返す stub.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPanel } from './renderer.ts';
import type { PanelDescriptor, RenderContext } from './types.ts';

// ── helpers ────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface DataCall {
  dataId: string;
  method?: string;
  params?: Record<string, string>;
  body?: unknown;
}

function makeCtx(opts?: {
  handlers?: Record<string, (call: DataCall) => Response | Promise<Response>>;
  isAdmin?: boolean;
}): { ctx: RenderContext; calls: DataCall[] } {
  const calls: DataCall[] = [];
  const ctx: RenderContext = {
    identity: {
      userId: 'u1',
      displayName: 'tester',
      isAdmin: opts?.isAdmin ?? false,
    },
    async data(dataId, callOpts) {
      const call: DataCall = {
        dataId,
        method: callOpts?.method,
        params: callOpts?.params,
        body: callOpts?.body,
      };
      calls.push(call);
      const handler = opts?.handlers?.[dataId];
      if (handler) return handler(call);
      // default: 空配列を返す
      return jsonResponse([]);
    },
  };
  return { ctx, calls };
}

function mount(): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return host;
}

/** マイクロタスクを 1 サイクル待つ (renderer の void async 待ち). */
async function flush(times = 2): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
  // jsdom の MessageChannel 等はないので setTimeout 0 で 1 sync 待つ
  await new Promise<void>((r) => setTimeout(r, 0));
}

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ── renderPanel skeleton ───────────────────────────────────────────────────

describe('renderPanel — skeleton', () => {
  it('renders title + section title + nested component', async () => {
    const host = mount();
    const { ctx } = makeCtx();
    const desc: PanelDescriptor = {
      descriptorVersion: 1,
      title: 'パネル A',
      sections: [
        { title: 'セクション 1', components: [] },
        { components: [] }, // title なし
      ],
    };
    renderPanel(host, desc, ctx);
    expect(host.querySelector('.corpus-panel-title')?.textContent).toBe('パネル A');
    expect(host.querySelectorAll('.corpus-section')).toHaveLength(2);
    expect(host.querySelectorAll('.corpus-section-title')).toHaveLength(1);
    expect(host.querySelector('.corpus-section-title')?.textContent).toBe('セクション 1');
  });

  it('clears previous content on re-render', async () => {
    const host = mount();
    const { ctx } = makeCtx();
    renderPanel(host, { descriptorVersion: 1, title: 'A', sections: [] }, ctx);
    renderPanel(host, { descriptorVersion: 1, title: 'B', sections: [] }, ctx);
    expect(host.querySelectorAll('.corpus-panel-title')).toHaveLength(1);
    expect(host.querySelector('.corpus-panel-title')?.textContent).toBe('B');
  });
});

// ── list ────────────────────────────────────────────────────────────────────

describe('list component', () => {
  it('renders cards from fetched array with template substitution', async () => {
    const host = mount();
    const { ctx } = makeCtx({
      handlers: {
        'items.list': () =>
          jsonResponse([
            { id: '1', name: 'Alice', age: 30 },
            { id: '2', name: 'Bob', age: 25 },
          ]),
      },
    });
    renderPanel(
      host,
      {
        descriptorVersion: 1,
        title: 'P',
        sections: [
          {
            components: [
              {
                type: 'list',
                dataSource: 'items.list',
                itemKey: 'id',
                item: {
                  title: '{name}',
                  subtitle: 'age={age}',
                  body: 'id={id}',
                },
              },
            ],
          },
        ],
      },
      ctx,
    );
    await flush();
    const cards = host.querySelectorAll('.corpus-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]!.querySelector('.corpus-card-title')?.textContent).toBe('Alice');
    expect(cards[0]!.querySelector('.corpus-card-sub')?.textContent).toBe('age=30');
    expect(cards[1]!.querySelector('.corpus-card-title')?.textContent).toBe('Bob');
  });

  it('extracts items via itemsPath', async () => {
    const host = mount();
    const { ctx } = makeCtx({
      handlers: {
        'wrapped': () => jsonResponse({ data: { items: [{ id: 'x', name: 'X' }] } }),
      },
    });
    renderPanel(host, {
      descriptorVersion: 1,
      title: 'P',
      sections: [
        {
          components: [
            {
              type: 'list',
              dataSource: 'wrapped',
              itemsPath: 'data.items',
              itemKey: 'id',
              item: { title: '{name}' },
            },
          ],
        },
      ],
    }, ctx);
    await flush();
    expect(host.querySelector('.corpus-card-title')?.textContent).toBe('X');
  });

  it('shows empty message when no items', async () => {
    const host = mount();
    const { ctx } = makeCtx({ handlers: { 'e': () => jsonResponse([]) } });
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'list', dataSource: 'e', itemKey: 'id',
        empty: '一件もない',
        item: { title: '{name}' },
      }] }],
    }, ctx);
    await flush();
    expect(host.querySelector('.corpus-empty')?.textContent).toBe('一件もない');
  });

  it('inline edit form swaps card → form → reload on save', async () => {
    const host = mount();
    const updates: DataCall[] = [];
    const { ctx, calls } = makeCtx({
      handlers: {
        'items': () => jsonResponse([{ id: '1', name: 'Alice' }]),
        'items.update': (c) => { updates.push(c); return jsonResponse({ ok: true }); },
      },
    });
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'list', dataSource: 'items', itemKey: 'id',
        item: {
          title: '{name}',
          edit: {
            dataId: 'items.update', method: 'PATCH',
            params: { id: '{id}' },
            fields: [{ name: 'name', label: '名前', input: 'text' }],
          },
        },
      }] }],
    }, ctx);
    await flush();
    const editBtn = host.querySelector<HTMLButtonElement>('.corpus-card-actions .corpus-btn.ghost');
    expect(editBtn?.textContent).toBe('編集');
    editBtn!.click();
    expect(host.querySelector('.corpus-edit-form')).toBeTruthy();

    const nameInput = host.querySelector<HTMLInputElement>('.corpus-edit-form input');
    expect(nameInput?.value).toBe('Alice'); // 元の値がセットされる
    nameInput!.value = 'Alice2';
    const form = host.querySelector<HTMLFormElement>('.corpus-edit-form')!;
    form.requestSubmit();
    await flush(5);

    expect(updates).toHaveLength(1);
    expect(updates[0]!.method).toBe('PATCH');
    expect(updates[0]!.params).toEqual({ id: '1' });
    expect((updates[0]!.body as any).name).toBe('Alice2');
    // 成功で reload (items が再 fetch される)
    const itemsCalls = calls.filter((c) => c.dataId === 'items');
    expect(itemsCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('shows error message on fetch failure', async () => {
    const host = mount();
    const { ctx } = makeCtx({
      handlers: { 'bad': () => { throw new Error('boom'); } },
    });
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'list', dataSource: 'bad', itemKey: 'id',
        item: { title: '{name}' },
      }] }],
    }, ctx);
    await flush(5);
    expect(host.querySelector('.corpus-error')?.textContent).toMatch(/取得失敗/);
  });
});

// ── form ───────────────────────────────────────────────────────────────────

describe('form component', () => {
  it('submits collected field values to dataId via method', async () => {
    const host = mount();
    const submits: DataCall[] = [];
    const { ctx } = makeCtx({
      handlers: { 'submit': (c) => { submits.push(c); return jsonResponse({ ok: true }); } },
    });
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'form',
        submit: { dataId: 'submit', method: 'POST', success: '送れた' },
        fields: [
          { name: 'title', label: 'タイトル', input: 'text', required: true },
          { name: 'count', label: '個数', input: 'number' },
          { name: 'note', label: 'メモ', input: 'textarea' },
          { name: 'active', label: '有効', input: 'checkbox' },
        ],
      }] }],
    }, ctx);
    await flush();
    (host.querySelector<HTMLInputElement>('input[type="text"]'))!.value = 'タスク';
    (host.querySelector<HTMLInputElement>('input[type="number"]'))!.value = '3';
    (host.querySelector<HTMLTextAreaElement>('textarea'))!.value = 'note';
    (host.querySelector<HTMLInputElement>('input[type="checkbox"]'))!.checked = true;
    host.querySelector<HTMLFormElement>('.corpus-form')!.requestSubmit();
    await flush(5);
    expect(submits).toHaveLength(1);
    expect(submits[0]!.method).toBe('POST');
    expect((submits[0]!.body as any).title).toBe('タスク');
    expect((submits[0]!.body as any).count).toBe('3');
    expect((submits[0]!.body as any).active).toBe('true');
    expect(host.querySelector('.corpus-status')?.textContent).toBe('送れた');
  });

  it('shows failure status when response is not ok', async () => {
    const host = mount();
    const { ctx } = makeCtx({
      handlers: { 's': () => jsonResponse({}, 500) },
    });
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'form',
        submit: { dataId: 's', method: 'POST' },
        fields: [{ name: 'x', label: 'X', input: 'text' }],
      }] }],
    }, ctx);
    await flush();
    host.querySelector<HTMLFormElement>('.corpus-form')!.requestSubmit();
    await flush(5);
    expect(host.querySelector('.corpus-status')?.className).toMatch(/err/);
    expect(host.querySelector('.corpus-status')?.textContent).toMatch(/失敗.*500/);
  });

  it('static select options are populated immediately', async () => {
    const host = mount();
    const { ctx } = makeCtx();
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'form',
        submit: { dataId: 's', method: 'POST' },
        fields: [{
          name: 'kind', label: '種別', input: 'select',
          options: [
            { label: 'りんご', value: 'apple' },
            { label: 'みかん', value: 'orange' },
          ],
        }],
      }] }],
    }, ctx);
    await flush();
    const opts = host.querySelectorAll<HTMLOptionElement>('select option');
    expect(opts).toHaveLength(2);
    expect(opts[0]!.value).toBe('apple');
    expect(opts[1]!.textContent).toBe('みかん');
  });

  it('dynamic select via optionsSource + optionDetail', async () => {
    const host = mount();
    const { ctx } = makeCtx({
      handlers: {
        'people': () => jsonResponse({
          rows: [
            { id: '1', name: 'A', age: 10 },
            { id: '2', name: 'B', age: 20 },
          ],
        }),
        's': () => jsonResponse({}),
      },
    });
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'form',
        submit: { dataId: 's', method: 'POST' },
        fields: [{
          name: 'who', label: '誰', input: 'select',
          optionsSource: 'people', optionsPath: 'rows',
          optionValue: 'id', optionLabel: 'name',
          optionDetail: [{ label: '齢', value: '{age}' }],
        }],
      }] }],
    }, ctx);
    await flush(5);
    const sel = host.querySelector<HTMLSelectElement>('select');
    expect(sel?.options.length).toBe(2);
    expect(sel?.options[0]!.value).toBe('1');
    expect(sel?.options[0]!.textContent).toBe('A');
    // 初期選択 (=1) の optionDetail が描かれる
    const detail = host.querySelector('.corpus-field-detail');
    expect(detail?.textContent).toMatch(/齢: 10/);
  });
});

// ── detail ─────────────────────────────────────────────────────────────────

describe('detail component', () => {
  it('renders dt/dd from fetched record with recordPath', async () => {
    const host = mount();
    const { ctx } = makeCtx({
      handlers: {
        'one': () => jsonResponse({ record: { name: 'Alice', age: 30 } }),
      },
    });
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'detail',
        dataSource: 'one', recordPath: 'record',
        fields: [
          { label: '名前', value: '{name}' },
          { label: '齢', value: '{age}' },
        ],
      }] }],
    }, ctx);
    await flush(5);
    const dts = Array.from(host.querySelectorAll('dt')).map((n) => n.textContent);
    const dds = Array.from(host.querySelectorAll('dd')).map((n) => n.textContent);
    expect(dts).toEqual(['名前', '齢']);
    expect(dds).toEqual(['Alice', '30']);
  });
});

// ── table ──────────────────────────────────────────────────────────────────

describe('table component', () => {
  it('renders columns + rows + rowActions header column', async () => {
    const host = mount();
    const { ctx } = makeCtx({
      handlers: { 't': () => jsonResponse([{ id: '1', name: 'X' }]) },
    });
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'table',
        dataSource: 't',
        columns: [
          { header: 'ID', value: '{id}' },
          { header: 'Name', value: '{name}' },
        ],
        rowActions: [{
          label: '削除', dataId: 't.delete', method: 'DELETE', params: { id: '{id}' },
        }],
      }] }],
    }, ctx);
    await flush(5);
    expect(host.querySelectorAll('thead th')).toHaveLength(3); // 2 cols + actions slot
    expect(host.querySelectorAll('tbody tr')).toHaveLength(1);
    const tds = host.querySelectorAll('tbody td');
    expect(tds[0]!.textContent).toBe('1');
    expect(tds[1]!.textContent).toBe('X');
    expect(tds[2]!.querySelector('button')?.textContent).toBe('削除');
  });
});

// ── stat ───────────────────────────────────────────────────────────────────

describe('stat component', () => {
  it('counts array length when no value template', async () => {
    const host = mount();
    const { ctx } = makeCtx({ handlers: { 'a': () => jsonResponse([1, 2, 3, 4]) } });
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{ type: 'stat', label: '件数', dataSource: 'a' }] }],
    }, ctx);
    await flush(5);
    expect(host.querySelector('.corpus-stat-label')?.textContent).toBe('件数');
    expect(host.querySelector('.corpus-stat-value')?.textContent).toBe('4');
  });

  it('uses value template against object response', async () => {
    const host = mount();
    const { ctx } = makeCtx({
      handlers: { 'a': () => jsonResponse({ total: 42 }) },
    });
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'stat', label: 'スコア', dataSource: 'a', value: 'score:{total}',
      }] }],
    }, ctx);
    await flush(5);
    expect(host.querySelector('.corpus-stat-value')?.textContent).toBe('score:42');
  });

  it('shows em dash on fetch failure', async () => {
    const host = mount();
    const { ctx } = makeCtx({ handlers: { 'x': () => { throw new Error('nope'); } } });
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{ type: 'stat', label: 'L', dataSource: 'x' }] }],
    }, ctx);
    await flush(5);
    expect(host.querySelector('.corpus-stat-value')?.textContent).toBe('—');
  });
});

// ── action-button (toggle + confirm) ───────────────────────────────────────

describe('action-button component', () => {
  it('button click triggers data call with success message', async () => {
    const host = mount();
    const { ctx, calls } = makeCtx({
      handlers: { 'fire': () => jsonResponse({ ok: true }) },
    });
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'action-button', label: '実行',
        action: { label: '実行', dataId: 'fire', method: 'POST', success: 'ok' },
      }] }],
    }, ctx);
    await flush();
    const btn = host.querySelector<HTMLButtonElement>('.corpus-btn.ghost')!;
    btn.click();
    await flush(5);
    expect(calls.filter((c) => c.dataId === 'fire')).toHaveLength(1);
    expect(host.querySelector('.corpus-status')?.textContent).toBe('ok');
  });

  it('toggle action sends {toggled} body and reverts on failure', async () => {
    const host = mount();
    const { ctx, calls } = makeCtx({
      handlers: { 'tg': () => jsonResponse({}, 500) },
    });
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'action-button', label: '切替',
        action: {
          label: '有効', dataId: 'tg', method: 'POST',
          kind: 'toggle', state: 'false',
          body: { enabled: '{toggled}' },
        },
      }] }],
    }, ctx);
    await flush();
    const cb = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(cb.checked).toBe(false);
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    await flush(5);
    expect((calls[0]!.body as any).enabled).toBe(true);
    // 失敗で UI が元に戻る
    expect(cb.checked).toBe(false);
  });

  it('confirm=false short-circuits without data call', async () => {
    const host = mount();
    const { ctx, calls } = makeCtx({ handlers: { 'd': () => jsonResponse({}) } });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'action-button', label: '消す',
        action: { label: '消す', dataId: 'd', method: 'DELETE', confirm: 'ほんとに?' },
      }] }],
    }, ctx);
    await flush();
    host.querySelector<HTMLButtonElement>('.corpus-btn.ghost')!.click();
    await flush(5);
    expect(calls.filter((c) => c.dataId === 'd')).toHaveLength(0);
  });
});

// ── section / tabs ─────────────────────────────────────────────────────────

describe('section / tabs', () => {
  it('section nests children under subsection-title', async () => {
    const host = mount();
    const { ctx } = makeCtx();
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'section', title: '内側',
        components: [{ type: 'stat', label: 'X', dataSource: 'x' }],
      }] }],
    }, ctx);
    await flush();
    expect(host.querySelector('.corpus-subsection-title')?.textContent).toBe('内側');
    expect(host.querySelector('.corpus-subsection .corpus-stat')).toBeTruthy();
  });

  it('tabs auto-clicks first tab and switches on second click', async () => {
    const host = mount();
    const { ctx } = makeCtx();
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'tabs',
        tabs: [
          { label: 'A', components: [{ type: 'stat', label: 'la', dataSource: 'x' }] },
          { label: 'B', components: [{ type: 'stat', label: 'lb', dataSource: 'x' }] },
        ],
      }] }],
    }, ctx);
    await flush();
    const btns = host.querySelectorAll<HTMLButtonElement>('.corpus-tab-btn');
    expect(btns).toHaveLength(2);
    expect(btns[0]!.classList.contains('active')).toBe(true);
    expect(host.querySelector('.corpus-tab-host .corpus-stat-label')?.textContent).toBe('la');
    btns[1]!.click();
    expect(btns[1]!.classList.contains('active')).toBe(true);
    expect(btns[0]!.classList.contains('active')).toBe(false);
    expect(host.querySelector('.corpus-tab-host .corpus-stat-label')?.textContent).toBe('lb');
  });
});

// ── requires=admin ─────────────────────────────────────────────────────────

describe('requires=admin gating', () => {
  it('hides component when isAdmin=false', () => {
    const host = mount();
    const { ctx } = makeCtx({ isAdmin: false });
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'stat', label: 'secret', dataSource: 'x', requires: 'admin',
      }] }],
    }, ctx);
    expect(host.querySelector('.corpus-stat')).toBeNull();
  });

  it('shows component when isAdmin=true', () => {
    const host = mount();
    const { ctx } = makeCtx({ isAdmin: true });
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'stat', label: 'secret', dataSource: 'x', requires: 'admin',
      }] }],
    }, ctx);
    expect(host.querySelector('.corpus-stat')).toBeTruthy();
  });

  it('hides admin-only action button within a card', async () => {
    const host = mount();
    const { ctx } = makeCtx({
      isAdmin: false,
      handlers: { 'i': () => jsonResponse([{ id: '1', name: 'X' }]) },
    });
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'list', dataSource: 'i', itemKey: 'id',
        item: {
          title: '{name}',
          actions: [{
            label: '消す', dataId: 'd', method: 'DELETE', requires: 'admin',
          }],
        },
      }] }],
    }, ctx);
    await flush(5);
    // admin 限定 action は描かれない → card-actions は空のままで append されない
    expect(host.querySelector('.corpus-card-actions')).toBeNull();
  });
});

// ── template + filters ─────────────────────────────────────────────────────

describe('template substitution + filters', () => {
  async function render(value: string, record: Record<string, unknown>): Promise<string> {
    const host = mount();
    const { ctx } = makeCtx({ handlers: { 's': () => jsonResponse(record) } });
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'stat', label: 'L', dataSource: 's', value,
      }] }],
    }, ctx);
    await flush(5);
    return host.querySelector('.corpus-stat-value')?.textContent ?? '';
  }

  it('plain {field}', async () => {
    expect(await render('hi {name}', { name: 'X' })).toBe('hi X');
  });

  it('nested path {a.b}', async () => {
    expect(await render('{a.b}', { a: { b: 'nested' } })).toBe('nested');
  });

  it('number filter', async () => {
    expect(await render('{n|number}', { n: '42' })).toBe('42');
  });

  it('truncate filter', async () => {
    expect(await render('{x|truncate:3}', { x: 'abcdef' })).toBe('abc…');
  });

  it('date filter on epoch ms', async () => {
    const ts = Date.UTC(2026, 4, 23, 12, 30); // 2026-05-23 12:30 UTC
    const out = await render('{t|date}', { t: ts });
    // 環境タイムゾーンに依存するが yyyy/mm/dd 形式である
    expect(out).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
  });

  it('time filter HH:MM', async () => {
    const out = await render('{t|time}', { t: Date.UTC(2026, 4, 23, 12, 30) });
    expect(out).toMatch(/^\d{2}:\d{2}$/);
  });

  it('missing field returns empty', async () => {
    expect(await render('hello {missing}!', { name: 'X' })).toBe('hello !');
  });
});

// ── custom component ──────────────────────────────────────────────────────

describe('custom component', () => {
  it('renders error message on failed dynamic import', async () => {
    const host = mount();
    const { ctx } = makeCtx();
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'custom',
        tag: 'my-widget',
        url: '/non-existent-module-xxx.js',
      }] }],
    }, ctx);
    // dynamic import の reject (vitest の module resolver 経由) は
    // microtask だけだと間に合わないことがあるので少し長めに待つ.
    await new Promise<void>((r) => setTimeout(r, 80));
    const err = host.querySelector('.corpus-custom .corpus-error');
    expect(err?.textContent ?? '').toMatch(/custom 読み込み失敗/);
  });
});
