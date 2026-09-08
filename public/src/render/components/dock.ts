// dock component (dockview-core ラップ、 Corpus DESIGN.md §13.4-9)。
//
// ユーザがドラッグで自由レイアウトできるサブパネル容器。
// 編集後の layout は dockview-core の toJSON 形式で localStorage に保存し、 次回
// 起動時に fromJSON で復元する。 リセットボタンで defaultLayout に戻せる。
//
// 注: dockview-core は ResizeObserver / requestAnimationFrame に依存するため、
// jsdom 上では実 layout は試せない. dispatcher 通過と DOM 構造の組立てまでを
// テスト対象にし、 実 layout は browser 統合で確認する.

import { createDockview, type DockviewApi } from 'dockview-core';

import type {
  DockComponent,
  DockLayoutNode,
  DockPanelDef,
  RenderContext,
} from '../types.ts';
import { el } from '../internal/dom.ts';
import type { RenderChild } from '../internal/render-child.ts';

const DOCK_STORAGE_PREFIX = 'corpus.dock.';

function loadStoredLayout(layoutId: string): unknown | null {
  try {
    const raw = globalThis.localStorage?.getItem(DOCK_STORAGE_PREFIX + layoutId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveStoredLayout(layoutId: string, layout: unknown): void {
  try {
    globalThis.localStorage?.setItem(DOCK_STORAGE_PREFIX + layoutId, JSON.stringify(layout));
  } catch {
    // localStorage が使えない環境では noop
  }
}

function clearStoredLayout(layoutId: string): void {
  try {
    globalThis.localStorage?.removeItem(DOCK_STORAGE_PREFIX + layoutId);
  } catch {
    // noop
  }
}

/**
 * defaultLayout (再帰木) を addPanel 呼びの列に展開する。 比率は dockview の
 * default (=均等) を採用し、 ユーザは UI 上の sash drag で調整する。
 */
function addLayoutRecursive(
  api: DockviewApi,
  node: DockLayoutNode,
  panels: Map<string, DockPanelDef>,
  refPanelId: string | null,
  direction: 'right' | 'below' | null,
): string | null {
  switch (node.kind) {
    case 'leaf': {
      const def = panels.get(node.panelId);
      if (!def) return null;
      const opts: Parameters<DockviewApi['addPanel']>[0] = {
        id:        def.id,
        component: 'corpus-dock-leaf',
        title:     def.title,
      };
      if (refPanelId && direction) {
        opts.position = { referencePanel: refPanelId, direction };
      }
      const p = api.addPanel(opts);
      return p.id;
    }
    case 'tabs': {
      const first = node.tabs[0];
      if (!first) return null;
      const firstDef = panels.get(first.panelId);
      if (!firstDef) return null;
      const opts: Parameters<DockviewApi['addPanel']>[0] = {
        id:        firstDef.id,
        component: 'corpus-dock-leaf',
        title:     first.title ?? firstDef.title,
      };
      if (refPanelId && direction) {
        opts.position = { referencePanel: refPanelId, direction };
      }
      const firstPanel = api.addPanel(opts);
      for (let i = 1; i < node.tabs.length; i++) {
        const t = node.tabs[i];
        if (!t) continue;
        const d = panels.get(t.panelId);
        if (!d) continue;
        api.addPanel({
          id:        d.id,
          component: 'corpus-dock-leaf',
          title:     t.title ?? d.title,
          position:  { referencePanel: firstPanel.id, direction: 'within' },
        });
      }
      const active = api.getPanel(node.active);
      if (active) active.api.setActive();
      return firstPanel.id;
    }
    case 'split': {
      const firstId = addLayoutRecursive(api, node.first, panels, refPanelId, direction);
      const childDir = node.orientation === 'horizontal' ? 'right' : 'below';
      const secondId = addLayoutRecursive(api, node.second, panels, firstId, childDir);
      return firstId ?? secondId;
    }
  }
}

export function renderDock(
  comp: DockComponent,
  ctx: RenderContext,
  renderChild: RenderChild,
): HTMLElement {
  const root = el('div', 'corpus-dock');

  const toolbar = el('div', 'corpus-dock-toolbar');
  const resetBtn = el('button', 'corpus-btn ghost', 'レイアウト初期化');
  toolbar.appendChild(resetBtn);
  root.appendChild(toolbar);

  const dockHost = el('div', 'corpus-dock-host');
  root.appendChild(dockHost);

  const panelDefs = new Map<string, DockPanelDef>();
  for (const p of comp.panels) panelDefs.set(p.id, p);

  // dockview-core 呼出しは ResizeObserver 等のブラウザ API に依存するため、
  // テスト環境では失敗しても致命にしない (jsdom 等)。
  let api: DockviewApi | null = null;
  try {
    api = createDockview(dockHost, {
      createComponent(options) {
        const def = panelDefs.get(options.id);
        const container = document.createElement('div');
        container.className = 'corpus-dock-leaf-body';
        if (def) {
          for (const child of def.components) {
            const node = renderChild(child, ctx);
            if (node) container.appendChild(node);
          }
        }
        return {
          element: container,
          init: () => {},
          dispose: () => {},
        };
      },
    });
  } catch (e) {
    dockHost.appendChild(el('p', 'corpus-error', `dock 初期化失敗: ${String(e)}`));
    return root;
  }

  const applyDefault = (): void => {
    api!.clear();
    addLayoutRecursive(api!, comp.defaultLayout, panelDefs, null, null);
  };

  const stored = loadStoredLayout(comp.layoutId);
  let restored = false;
  if (stored && typeof stored === 'object') {
    try {
      api.fromJSON(stored as never);
      restored = true;
    } catch {
      // fromJSON 失敗は default にフォールバック
    }
  }
  if (!restored) applyDefault();

  api.onDidLayoutChange(() => {
    try {
      saveStoredLayout(comp.layoutId, api!.toJSON());
    } catch {
      // toJSON 失敗は noop (layout 保存スキップ)
    }
  });

  resetBtn.onclick = () => {
    clearStoredLayout(comp.layoutId);
    applyDefault();
  };

  return root;
}
