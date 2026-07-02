// ComponentDescriptor → 各 component 描画のディスパッチ。
//
// requires: "admin" のゲートと type 分岐のみを担当する。 コンテナ component
// (modal / grid / stack / dock / section / tabs) には自身を renderChild として
// 注入し、 依存方向を dispatch → components → internal の一方向に保つ。

import type { ComponentDescriptor, RenderContext } from './types.ts';
import { renderActionControl } from './internal/actions.ts';
import { el, makeStatus } from './internal/dom.ts';
import { renderCustom } from './components/custom.ts';
import { renderDetail } from './components/detail.ts';
import { renderDock } from './components/dock.ts';
import { renderForm } from './components/form.ts';
import { renderGrid, renderStack } from './components/layout.ts';
import { renderList } from './components/list.ts';
import { renderModal } from './components/modal.ts';
import { renderStat } from './components/stat.ts';
import { renderTable } from './components/table.ts';

export function renderComponent(
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
    case 'modal':
      return renderModal(comp, ctx, renderComponent);
    case 'grid':
      return renderGrid(comp, ctx, renderComponent);
    case 'stack':
      return renderStack(comp, ctx, renderComponent);
    case 'dock':
      return renderDock(comp, ctx, renderComponent);
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
