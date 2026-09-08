// 見出し付きの子 component コンテナ。
import type { ComponentDescriptor, RenderContext } from '../types.ts';
import { el } from '../internal/dom.ts';
import type { RenderChild } from '../internal/render-child.ts';

export function renderSection(
  comp: Extract<ComponentDescriptor, { type: 'section' }>,
  ctx: RenderContext,
  renderChild: RenderChild,
): HTMLElement {
  const sec = el('div', 'corpus-subsection');
  if (comp.title) sec.appendChild(el('h4', 'corpus-subsection-title', comp.title));
  for (const child of comp.components) {
    const node = renderChild(child, ctx);
    if (node) sec.appendChild(node);
  }
  return sec;
}
