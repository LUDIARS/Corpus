// @vitest-environment jsdom
//
// modal / pagination 拡張 (corpus-renderer §13 続編) の挙動を検証.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPanel } from './renderer.ts';
import type { PanelDescriptor, RenderContext } from './types.ts';

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

async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
  await new Promise<void>((r) => setTimeout(r, 0));
}

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { vi.restoreAllMocks(); });

// ── modal ──────────────────────────────────────────────────────────────────

describe('modal component', () => {
  it('renders trigger button only initially; modal appears on click', async () => {
    const host = mount();
    const { ctx } = makeCtx();
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'modal',
        label: '開く',
        title: 'ダイアログ',
        components: [{ type: 'stat', label: 'X', dataSource: 'x' }],
      }] }],
    }, ctx);
    await flush();

    // trigger は描かれているが、 dialog はまだ無い
    const trigger = host.querySelector<HTMLButtonElement>('.corpus-btn.ghost');
    expect(trigger?.textContent).toBe('開く');
    expect(document.querySelector('.corpus-modal')).toBeNull();

    trigger!.click();
    await flush();

    const dialog = document.querySelector<HTMLDialogElement>('.corpus-modal');
    expect(dialog).toBeTruthy();
    expect(dialog?.querySelector('.corpus-modal-title')?.textContent).toBe('ダイアログ');
    // 中身 (stat) も描画されている
    expect(dialog?.querySelector('.corpus-stat-label')?.textContent).toBe('X');
  });

  it('close button removes the dialog from DOM', async () => {
    const host = mount();
    const { ctx } = makeCtx();
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'modal', label: 'open', components: [],
      }] }],
    }, ctx);
    await flush();
    host.querySelector<HTMLButtonElement>('.corpus-btn')!.click();
    await flush();
    expect(document.querySelector('.corpus-modal')).toBeTruthy();
    document.querySelector<HTMLButtonElement>('.corpus-modal-close')!.click();
    await flush();
    expect(document.querySelector('.corpus-modal')).toBeNull();
  });

  it('title falls back to label when not specified', async () => {
    const host = mount();
    const { ctx } = makeCtx();
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'modal', label: 'ラベルだけ', components: [],
      }] }],
    }, ctx);
    await flush();
    host.querySelector<HTMLButtonElement>('.corpus-btn')!.click();
    await flush();
    expect(document.querySelector('.corpus-modal-title')?.textContent).toBe('ラベルだけ');
  });

  it('variant=primary applies to trigger button class', async () => {
    const host = mount();
    const { ctx } = makeCtx();
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'modal', label: '送信', variant: 'primary', components: [],
      }] }],
    }, ctx);
    await flush();
    const btn = host.querySelector<HTMLButtonElement>('.corpus-btn')!;
    expect(btn.className).toMatch(/primary/);
  });

  it('requires=admin gating hides trigger for non-admin', async () => {
    const host = mount();
    const { ctx } = makeCtx({ isAdmin: false });
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'modal', label: 'admin だけ', requires: 'admin', components: [],
      }] }],
    }, ctx);
    await flush();
    expect(host.querySelector('.corpus-btn')).toBeNull();
  });

  it('modal can contain a form whose submit triggers ctx.data', async () => {
    const host = mount();
    const submits: DataCall[] = [];
    const { ctx } = makeCtx({
      handlers: { 'submit': (c) => { submits.push(c); return jsonResponse({ ok: true }); } },
    });
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'modal', label: '入力',
        components: [{
          type: 'form',
          submit: { dataId: 'submit', method: 'POST' },
          fields: [{ name: 'title', label: 'タイトル', input: 'text' }],
        }],
      }] }],
    }, ctx);
    await flush();
    host.querySelector<HTMLButtonElement>('.corpus-btn')!.click();
    await flush();
    const dialog = document.querySelector('.corpus-modal')!;
    dialog.querySelector<HTMLInputElement>('input[type="text"]')!.value = 'タスク A';
    dialog.querySelector<HTMLFormElement>('.corpus-form')!.requestSubmit();
    await flush(8);
    expect(submits).toHaveLength(1);
    expect((submits[0].body as any).title).toBe('タスク A');
  });
});

// ── list pagination ────────────────────────────────────────────────────────

describe('list pagination', () => {
  it('sends page/limit params; next/prev jumps and re-fetches', async () => {
    const host = mount();
    const pages: Record<string, Record<string, unknown>[]> = {
      '1': [{ id: 'a' }, { id: 'b' }],
      '2': [{ id: 'c' }],
    };
    const { ctx, calls } = makeCtx({
      handlers: {
        'items': (c) => {
          const p = c.params?.['page'] ?? '1';
          return jsonResponse(pages[p] ?? []);
        },
      },
    });
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'list', dataSource: 'items', itemKey: 'id',
        item: { title: '{id}' },
        pagination: { pageSize: 2 },
      }] }],
    }, ctx);
    await flush(8);

    // page=1 初期 fetch: 2 件描画 + bar 表示
    expect(host.querySelectorAll('.corpus-card')).toHaveLength(2);
    expect(calls[0].params?.['page']).toBe('1');
    const bar = host.querySelector('.corpus-pagination');
    expect(bar).toBeTruthy();
    const buttons = host.querySelectorAll<HTMLButtonElement>('.corpus-pagination .corpus-btn');
    expect(buttons[0].textContent).toBe('前へ');
    expect(buttons[0].disabled).toBe(true); // 1 ページ目なので prev disabled
    expect(buttons[1].textContent).toBe('次へ');

    // 次へ → page=2 fetch
    buttons[1].click();
    await flush(8);
    expect(host.querySelectorAll('.corpus-card')).toHaveLength(1);
    expect(calls.at(-1)?.params?.['page']).toBe('2');
    // 1 件しか帰ってこなかった (pageSize=2 未満) ので最終扱い → next disabled
    const buttons2 = host.querySelectorAll<HTMLButtonElement>('.corpus-pagination .corpus-btn');
    expect(buttons2[1].disabled).toBe(true);
  });

  it('uses totalPath to compute last page', async () => {
    const host = mount();
    const { ctx } = makeCtx({
      handlers: {
        'items': () => jsonResponse({
          items: [{ id: '1' }, { id: '2' }],
          meta: { total: 5 },
        }),
      },
    });
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'list', dataSource: 'items', itemKey: 'id',
        itemsPath: 'items',
        item: { title: '{id}' },
        pagination: { pageSize: 2, totalPath: 'meta.total' },
      }] }],
    }, ctx);
    await flush(8);
    const label = host.querySelector('.corpus-pagination-label');
    expect(label?.textContent).toBe('1 / 3 (計 5)');
  });

  it('honors custom pageParam / limitParam names', async () => {
    const host = mount();
    const { ctx, calls } = makeCtx({
      handlers: { 'items': () => jsonResponse([]) },
    });
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'list', dataSource: 'items', itemKey: 'id',
        item: { title: '{id}' },
        pagination: { pageSize: 10, pageParam: 'p', limitParam: 'n' },
      }] }],
    }, ctx);
    await flush(8);
    expect(calls[0].params?.['p']).toBe('1');
    expect(calls[0].params?.['n']).toBe('10');
  });
});

// ── table pagination ────────────────────────────────────────────────────────

describe('table pagination', () => {
  it('renders pagination bar and re-fetches on next click', async () => {
    const host = mount();
    const { ctx, calls } = makeCtx({
      handlers: { 't': () => jsonResponse([{ id: 'a' }, { id: 'b' }]) },
    });
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'table', dataSource: 't',
        columns: [{ header: 'ID', value: '{id}' }],
        pagination: { pageSize: 2 },
      }] }],
    }, ctx);
    await flush(8);
    expect(host.querySelector('.corpus-pagination')).toBeTruthy();
    expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
    const next = host.querySelectorAll<HTMLButtonElement>('.corpus-pagination .corpus-btn')[1];
    next.click();
    await flush(8);
    // page=2 が requested
    expect(calls.at(-1)?.params?.['page']).toBe('2');
  });
});
