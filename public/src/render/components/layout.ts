// レイアウター (grid / stack)。
//
// 業務 (descriptor) と並べ方を分離する設計の一環. CSS variables を inline で
// 渡し、 breakpoint (640px) で PC ↔ スマホを切り替える. media query は
// style.css 側で 1 度だけ書く (各 component が個別 media query を生やさない).

import type { GridComponent, RenderContext, StackComponent } from '../types.ts';
import { el } from '../internal/dom.ts';
import type { RenderChild } from '../internal/render-child.ts';

export function renderGrid(
  comp: GridComponent,
  ctx: RenderContext,
  renderChild: RenderChild,
): HTMLElement {
  const root = el('div', 'corpus-grid');
  root.style.setProperty('--corpus-cols', String(comp.columns));
  root.style.setProperty('--corpus-mobile-cols', String(comp.mobileColumns ?? 1));
  if (comp.gap != null) root.style.setProperty('--corpus-gap', `${comp.gap}rem`);
  for (const child of comp.components) {
    const node = renderChild(child, ctx);
    if (node) root.appendChild(node);
  }
  return root;
}

export function renderStack(
  comp: StackComponent,
  ctx: RenderContext,
  renderChild: RenderChild,
): HTMLElement {
  const responsive = comp.responsive ?? true;
  const root = el('div', `corpus-stack${responsive ? ' responsive' : ''}`);
  root.style.setProperty('--corpus-direction', comp.direction ?? 'row');
  if (comp.wrap === false) root.style.setProperty('--corpus-wrap', 'nowrap');
  if (comp.gap != null) root.style.setProperty('--corpus-gap', `${comp.gap}rem`);
  for (const child of comp.components) {
    const node = renderChild(child, ctx);
    if (node) root.appendChild(node);
  }
  return root;
}
