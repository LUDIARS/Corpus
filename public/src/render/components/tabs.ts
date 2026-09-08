// タブの選択と選択中の子 component の描画。
import type { ComponentDescriptor, RenderContext } from '../types.ts';
import { el } from '../internal/dom.ts';
import type { RenderChild } from '../internal/render-child.ts';

export function renderTabs(
  comp: Extract<ComponentDescriptor, { type: 'tabs' }>,
  ctx: RenderContext,
  renderChild: RenderChild,
): HTMLElement {
  const wrap = el('div', 'corpus-tabs');
  const bar = el('div', 'corpus-tab-bar');
  const host = el('div', 'corpus-tab-host');
  wrap.append(bar, host);
  comp.tabs.forEach((tab, i) => {
    const btn = el('button', 'corpus-tab-btn', tab.label);
    btn.onclick = () => {
      host.innerHTML = '';
      for (const child of tab.components) {
        const node = renderChild(child, ctx);
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
