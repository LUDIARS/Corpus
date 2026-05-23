// @vitest-environment jsdom
//
// E2E pilot: 実サービス Bibliotheca の corpus.ts に書かれた loan panel descriptor を
// fixture として取り込み、 corpus-renderer で実際に DOM へ描画した結果を検証する.
//
// fixture (`fixtures/bibliotheca-loans.json`) は `Bibliotheca/server/corpus.ts` の
// `loanPanel` をそのまま JSON 化したもの. Bibliotheca 側が変更された場合は手動で
// 同期する (drift 検知は別途 — 静的検証 PR の宿題).
//
// この test の目的は 「実サービスの descriptor が corpus-renderer の現在の実装で
// crash せずに、 期待される DOM 要素を生やすこと」 を保証することにある.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/bibliotheca-loans.json' assert { type: 'json' };
import { renderPanel } from './renderer.ts';
import type { PanelDescriptor, RenderContext } from './types.ts';

const panel = fixture as unknown as PanelDescriptor;

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

function makeCtx(opts: {
  isAdmin?: boolean;
  handlers?: Record<string, (call: DataCall) => Response | Promise<Response>>;
} = {}): { ctx: RenderContext; calls: DataCall[] } {
  const calls: DataCall[] = [];
  const ctx: RenderContext = {
    identity: {
      userId: 'u1',
      displayName: 'tester',
      isAdmin: opts.isAdmin ?? false,
    },
    async data(dataId, callOpts) {
      const call: DataCall = {
        dataId,
        method: callOpts?.method,
        params: callOpts?.params,
        body: callOpts?.body,
      };
      calls.push(call);
      return opts.handlers?.[dataId]?.(call) ?? jsonResponse({ items: [] });
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

// ── fixture sanity ─────────────────────────────────────────────────────────

describe('Bibliotheca loanPanel — fixture shape', () => {
  it('parses as PanelDescriptor with 3 sections', () => {
    expect(panel.descriptorVersion).toBe(1);
    expect(panel.title).toBe('蔵書・機材 貸出');
    expect(panel.sections).toHaveLength(3);
    expect(panel.sections.map((s) => s.title)).toEqual(['貸出', '貸出中', '自分の貸出']);
  });
});

// ── render skeleton ────────────────────────────────────────────────────────

describe('Bibliotheca loanPanel — skeleton render', () => {
  it('renders title + 3 section titles', async () => {
    const host = mount();
    const { ctx } = makeCtx();
    renderPanel(host, panel, ctx);
    await flush();
    expect(host.querySelector('.corpus-panel-title')?.textContent).toBe('蔵書・機材 貸出');
    const titles = Array.from(host.querySelectorAll('.corpus-section-title')).map((n) => n.textContent);
    expect(titles).toEqual(['貸出', '貸出中', '自分の貸出']);
  });

  it('exposes loan form with 4 fields (select + text + date + text)', async () => {
    const host = mount();
    const { ctx } = makeCtx();
    renderPanel(host, panel, ctx);
    await flush();
    const form = host.querySelector('.corpus-form');
    expect(form).toBeTruthy();

    const labels = Array.from(form!.querySelectorAll('.corpus-field-label')).map((n) => n.textContent);
    expect(labels).toEqual(['種別', 'ISBN / QR コード', '返却期限', 'メモ']);

    // select の選択肢は 2 つ (本 / 機材)
    const select = form!.querySelector<HTMLSelectElement>('select')!;
    expect(select.options.length).toBe(2);
    expect(select.options[0].value).toBe('book');
    expect(select.options[1].value).toBe('equipment');

    // date input
    expect(form!.querySelector<HTMLInputElement>('input[type="date"]')).toBeTruthy();
    // required は 'source' (select) + 'external_key' (text) の 2 つ
    expect(form!.querySelectorAll<HTMLElement>('[required]').length).toBe(2);
    // メモは maxLength=200
    const noteInput = Array.from(form!.querySelectorAll<HTMLInputElement>('input[type="text"]')).find(
      (i) => i.maxLength === 200,
    );
    expect(noteInput).toBeTruthy();
  });
});

// ── data fetch wiring ──────────────────────────────────────────────────────

describe('Bibliotheca loanPanel — data wiring', () => {
  it('fetches loans-open and loans-mine on mount', async () => {
    const host = mount();
    const { ctx, calls } = makeCtx();
    renderPanel(host, panel, ctx);
    await flush(8);
    const ids = calls.map((c) => c.dataId).sort();
    expect(ids).toEqual(['loans-mine', 'loans-open']);
  });

  it('renders cards from loans-open response (itemsPath=items + template fields)', async () => {
    const host = mount();
    const now = Date.UTC(2026, 4, 23, 9, 30);
    const { ctx } = makeCtx({
      handlers: {
        'loans-open': () =>
          jsonResponse({
            items: [
              {
                id: 'loan-1',
                label: '吾輩は猫である',
                external_key: '9784101010014',
                borrowed_at: now,
                borrower_display_name: '田中',
              },
            ],
          }),
      },
    });
    renderPanel(host, panel, ctx);
    await flush(8);

    const cards = host.querySelectorAll('.corpus-card');
    // 1 件 (loans-open) + 0 件 (loans-mine、 empty 表示)
    expect(cards).toHaveLength(1);
    expect(cards[0].querySelector('.corpus-card-title')?.textContent).toBe('吾輩は猫である');
    expect(cards[0].querySelector('.corpus-card-sub')?.textContent).toMatch(/9784101010014/);
    // datetime filter で yyyy/mm/dd hh:mm 形式が含まれる
    expect(cards[0].querySelector('.corpus-card-sub')?.textContent).toMatch(/\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}/);
    expect(cards[0].querySelector('.corpus-card-meta')?.textContent).toBe('田中');
  });

  it('shows empty messages from both lists when no items', async () => {
    const host = mount();
    const { ctx } = makeCtx({
      handlers: {
        'loans-open': () => jsonResponse({ items: [] }),
        'loans-mine': () => jsonResponse({ items: [] }),
      },
    });
    renderPanel(host, panel, ctx);
    await flush(8);
    const empties = Array.from(host.querySelectorAll('.corpus-empty')).map((n) => n.textContent);
    expect(empties).toContain('貸出中の物品はありません');
    expect(empties).toContain('借りている物品はありません');
  });
});

// ── admin gating + return action ───────────────────────────────────────────

describe('Bibliotheca loanPanel — admin gating', () => {
  it('hides 返却 button for non-admin user', async () => {
    const host = mount();
    const { ctx } = makeCtx({
      handlers: {
        'loans-open': () => jsonResponse({ items: [{ id: 'l1', label: 'X', external_key: 'k', borrowed_at: 0 }] }),
      },
    });
    renderPanel(host, panel, ctx);
    await flush(8);
    // 返却ボタンが描かれていない (admin 限定)
    const btns = Array.from(host.querySelectorAll<HTMLButtonElement>('.corpus-card-actions .corpus-btn')).filter(
      (b) => b.textContent === '返却',
    );
    expect(btns).toHaveLength(0);
  });

  it('shows 返却 button for admin user; click triggers ctx.data with params and admin confirm', async () => {
    const host = mount();
    const returns: DataCall[] = [];
    const { ctx } = makeCtx({
      isAdmin: true,
      handlers: {
        'loans-open': () => jsonResponse({ items: [{ id: 'l1', label: 'X', external_key: 'k', borrowed_at: 0 }] }),
        'loan-return': (c) => { returns.push(c); return jsonResponse({ ok: true }); },
      },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPanel(host, panel, ctx);
    await flush(8);

    const btn = Array.from(host.querySelectorAll<HTMLButtonElement>('.corpus-card-actions .corpus-btn')).find(
      (b) => b.textContent === '返却',
    );
    expect(btn).toBeTruthy();
    btn!.click();
    await flush(8);
    expect(returns).toHaveLength(1);
    expect(returns[0].method).toBe('POST');
    expect(returns[0].params).toEqual({ id: 'l1' });
    expect(window.confirm).toHaveBeenCalledWith('返却済みにしますか?');
  });
});

// ── form submission ───────────────────────────────────────────────────────

describe('Bibliotheca loanPanel — form submit', () => {
  it('posts collected fields to loans dataId on submit', async () => {
    const host = mount();
    const submits: DataCall[] = [];
    const { ctx } = makeCtx({
      handlers: { 'loans': (c) => { submits.push(c); return jsonResponse({ ok: true }); } },
    });
    renderPanel(host, panel, ctx);
    await flush(8);

    const form = host.querySelector<HTMLFormElement>('.corpus-form')!;
    const select = form.querySelector<HTMLSelectElement>('select')!;
    select.value = 'book';
    const externalKey = form.querySelectorAll<HTMLInputElement>('input[type="text"]')[0];
    externalKey.value = '9784101010014';
    const date = form.querySelector<HTMLInputElement>('input[type="date"]')!;
    date.value = '2026-06-01';
    const note = form.querySelectorAll<HTMLInputElement>('input[type="text"]')[1];
    note.value = '研修用';

    form.requestSubmit();
    await flush(10);

    expect(submits).toHaveLength(1);
    expect(submits[0].method).toBe('POST');
    const body = submits[0].body as Record<string, string>;
    expect(body.source).toBe('book');
    expect(body.external_key).toBe('9784101010014');
    expect(body.due_at).toBe('2026-06-01');
    expect(body.note).toBe('研修用');
    // 成功 status が描かれる
    expect(host.querySelector('.corpus-status.ok')?.textContent).toBe('貸出を記録しました');
  });
});
