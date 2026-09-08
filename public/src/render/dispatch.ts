// ComponentDescriptor → 各 component 描画のディスパッチ。
//
// requires: "admin" のゲートと type 分岐のみを担当する。 コンテナ component
// (modal / grid / stack / dock / section / tabs) には自身を renderChild として
// 注入し、 依存方向を dispatch → components → internal の一方向に保つ。

import type { ComponentDescriptor, RenderContext } from './types.ts';
import { renderActionButton } from './components/action-button.ts';
import { renderSection } from './components/section.ts';
import { renderTabs } from './components/tabs.ts';
import { renderText } from './components/text.ts';
import { renderUnresolvedRef } from './components/unresolved-ref.ts';
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
    case 'action-button':
      return renderActionButton(comp, ctx);
    case 'custom':
      return renderCustom(comp);
    case 'text':
      return renderText(comp);
    case 'ref':
      return renderUnresolvedRef(comp);
    case 'modal':
      return renderModal(comp, ctx, renderComponent);
    case 'grid':
      return renderGrid(comp, ctx, renderComponent);
    case 'stack':
      return renderStack(comp, ctx, renderComponent);
    case 'dock':
      return renderDock(comp, ctx, renderComponent);
    case 'section':
      return renderSection(comp, ctx, renderComponent);
    case 'tabs':
      return renderTabs(comp, ctx, renderComponent);
  }
}
