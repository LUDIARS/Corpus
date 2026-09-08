// 独立した action control と結果表示の配置。
import type { ComponentDescriptor, RenderContext } from '../types.ts';
import { renderActionControl } from '../internal/actions.ts';
import { el, makeStatus } from '../internal/dom.ts';

export function renderActionButton(
  comp: Extract<ComponentDescriptor, { type: 'action-button' }>,
  ctx: RenderContext,
): HTMLElement {
  const status = makeStatus();
  const wrap = el('div', 'corpus-action-wrap');
  const ctrl = renderActionControl(comp.action, {}, ctx, () => {}, status.set);
  if (ctrl) wrap.append(ctrl, status.node);
  return wrap;
}
