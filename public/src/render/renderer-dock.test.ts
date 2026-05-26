// @vitest-environment jsdom
//
// dock component (DESIGN.md §13.4-9) の DOM 組立てと localStorage 永続化を
// 検証する. dockview-core 本体は ResizeObserver / requestAnimationFrame 依存
// で jsdom 上で完全には動かないので vi.mock で in-memory stub に置換する.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface StubPanel {
  id:    string;
  title: string;
  api:   { setActive: () => void };
}

interface StubApi {
  panels:             StubPanel[];
  addPanelCalls:      unknown[];
  fromJSONCalls:      unknown[];
  toJSONReturn:       unknown;
  layoutChangeCb:     null | (() => void);
  addPanel:           (opts: { id: string; title: string; component: string; position?: unknown }) => StubPanel;
  getPanel:           (id: string) => StubPanel | undefined;
  fromJSON:           (data: unknown) => void;
  toJSON:             () => unknown;
  clear:              () => void;
  onDidLayoutChange:  (cb: () => void) => { dispose: () => void };
}

let lastApi: StubApi | null = null;

vi.mock('dockview-core', () => ({
  createDockview: vi.fn((host: HTMLElement, opts: { createComponent: (o: { id: string; name: string }) => { element: HTMLElement; init: () => void; dispose: () => void } }) => {
    host.classList.add('dv-dockview');
    const api: StubApi = {
      panels: [],
      addPanelCalls: [],
      fromJSONCalls: [],
      toJSONReturn: { stub: 'layout' },
      layoutChangeCb: null,
      addPanel(arg) {
        api.addPanelCalls.push(arg);
        // factory を呼んで content を生成 (実 dockview と同じく)
        const content = opts.createComponent({ id: arg.id, name: arg.component });
        host.appendChild(content.element);
        const panel: StubPanel = { id: arg.id, title: arg.title, api: { setActive: vi.fn() } };
        api.panels.push(panel);
        return panel;
      },
      getPanel(id) { return api.panels.find((p) => p.id === id); },
      fromJSON(data) { api.fromJSONCalls.push(data); },
      toJSON() { return api.toJSONReturn; },
      clear() { api.panels = []; },
      onDidLayoutChange(cb) {
        api.layoutChangeCb = cb;
        return { dispose: () => {} };
      },
    };
    lastApi = api;
    return api;
  }),
}));

// mock 後に import (vi.mock は hoist されるが安全のため)
const { renderPanel } = await import('./renderer.ts');
type PanelDescriptor = import('./types.ts').PanelDescriptor;
type RenderContext   = import('./types.ts').RenderContext;

const ctx: RenderContext = {
  identity: { userId: 'u', displayName: null, isAdmin: false },
  async data() { return new Response('[]'); },
};

function mount(): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return host;
}

beforeEach(() => {
  document.body.innerHTML = '';
  globalThis.localStorage.clear();
  lastApi = null;
});

afterEach(() => { vi.clearAllMocks(); });

// ── tests ──────────────────────────────────────────────────────────────────

describe('dock component', () => {
  it('mounts dock host + toolbar reset button', () => {
    const host = mount();
    const desc: PanelDescriptor = {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'dock',
        layoutId: 'lid-mount',
        defaultLayout: { kind: 'leaf', panelId: 'a' },
        panels: [{ id: 'a', title: 'A', components: [] }],
      }] }],
    };
    renderPanel(host, desc, ctx);
    expect(host.querySelector('.corpus-dock')).not.toBeNull();
    expect(host.querySelector('.corpus-dock-host')?.classList.contains('dv-dockview')).toBe(true);
    const btn = host.querySelector('.corpus-dock-toolbar button');
    expect(btn?.textContent).toContain('レイアウト初期化');
  });

  it('applies defaultLayout when no stored layout exists', () => {
    const host = mount();
    const desc: PanelDescriptor = {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'dock',
        layoutId: 'lid-default',
        defaultLayout: {
          kind: 'split', orientation: 'horizontal', ratio: 0.5,
          first:  { kind: 'leaf', panelId: 'a' },
          second: { kind: 'leaf', panelId: 'b' },
        },
        panels: [
          { id: 'a', title: 'A', components: [] },
          { id: 'b', title: 'B', components: [] },
        ],
      }] }],
    };
    renderPanel(host, desc, ctx);
    expect(lastApi?.addPanelCalls.length).toBe(2);
    expect(lastApi?.fromJSONCalls.length).toBe(0);
  });

  it('restores from localStorage when present', () => {
    globalThis.localStorage.setItem(
      'corpus.dock.lid-restore',
      JSON.stringify({ stored: 'layout' }),
    );
    const host = mount();
    const desc: PanelDescriptor = {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'dock',
        layoutId: 'lid-restore',
        defaultLayout: { kind: 'leaf', panelId: 'a' },
        panels: [{ id: 'a', title: 'A', components: [] }],
      }] }],
    };
    renderPanel(host, desc, ctx);
    expect(lastApi?.fromJSONCalls).toEqual([{ stored: 'layout' }]);
    // restore したので defaultLayout の addPanel は呼ばれない
    expect(lastApi?.addPanelCalls.length).toBe(0);
  });

  it('saves layout to localStorage when dockview emits change', () => {
    const host = mount();
    const desc: PanelDescriptor = {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'dock',
        layoutId: 'lid-save',
        defaultLayout: { kind: 'leaf', panelId: 'a' },
        panels: [{ id: 'a', title: 'A', components: [] }],
      }] }],
    };
    renderPanel(host, desc, ctx);
    expect(lastApi?.layoutChangeCb).not.toBeNull();
    lastApi!.layoutChangeCb!();
    expect(globalThis.localStorage.getItem('corpus.dock.lid-save')).toBe(
      JSON.stringify({ stub: 'layout' }),
    );
  });

  it('reset button clears localStorage and re-applies default', () => {
    globalThis.localStorage.setItem('corpus.dock.lid-reset', JSON.stringify({ x: 1 }));
    const host = mount();
    const desc: PanelDescriptor = {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'dock',
        layoutId: 'lid-reset',
        defaultLayout: { kind: 'leaf', panelId: 'a' },
        panels: [{ id: 'a', title: 'A', components: [] }],
      }] }],
    };
    renderPanel(host, desc, ctx);
    const before = lastApi!.addPanelCalls.length;
    const btn = host.querySelector<HTMLButtonElement>('.corpus-dock-toolbar button')!;
    btn.click();
    expect(globalThis.localStorage.getItem('corpus.dock.lid-reset')).toBeNull();
    expect(lastApi!.addPanelCalls.length).toBeGreaterThan(before);
  });

  it('expands tabs layout: first as base, rest within same group', () => {
    const host = mount();
    const desc: PanelDescriptor = {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'dock',
        layoutId: 'lid-tabs',
        defaultLayout: {
          kind: 'tabs', active: 'b',
          tabs: [{ panelId: 'a' }, { panelId: 'b' }, { panelId: 'c' }],
        },
        panels: [
          { id: 'a', title: 'A', components: [] },
          { id: 'b', title: 'B', components: [] },
          { id: 'c', title: 'C', components: [] },
        ],
      }] }],
    };
    renderPanel(host, desc, ctx);
    expect(lastApi?.addPanelCalls.length).toBe(3);
    // 2 番目以降は position.referencePanel=first, direction=within
    const second = lastApi!.addPanelCalls[1] as { position?: { direction: string } };
    expect(second.position?.direction).toBe('within');
  });
});
