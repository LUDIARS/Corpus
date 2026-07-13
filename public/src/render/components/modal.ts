// modal component。
//
// トリガボタンと <dialog> の開閉を担当する。 中身の component 描画は
// dispatch から注入される renderChild に委ねる。

import type { ModalComponent, RenderContext } from '../types.ts';
import { el } from '../internal/dom.ts';
import type { RenderChild } from '../internal/render-child.ts';

function closeDialog(dialog: HTMLDialogElement): void {
  // jsdom 等は HTMLDialogElement.close を未実装. fallback で close event を手動発火.
  if (typeof dialog.close === 'function') {
    dialog.close();
  } else {
    dialog.removeAttribute('open');
    dialog.dispatchEvent(new Event('close'));
  }
}

export function renderModal(
  comp: ModalComponent,
  ctx: RenderContext,
  renderChild: RenderChild,
): HTMLElement {
  const variant = comp.variant ?? 'ghost';
  const trigger = el('button', `corpus-btn ${variant}`, comp.label);
  trigger.onclick = () => {
    const dialog = document.createElement('dialog');
    dialog.className = 'corpus-modal';
    const header = el('header', 'corpus-modal-header');
    header.appendChild(el('h3', 'corpus-modal-title', comp.title ?? comp.label));
    const closeBtn = el('button', 'corpus-modal-close', '×');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', '閉じる');
    closeBtn.onclick = () => closeDialog(dialog);
    header.appendChild(closeBtn);
    const bodyHost = el('div', 'corpus-modal-body');
    for (const child of comp.components) {
      const node = renderChild(child, ctx);
      if (node) bodyHost.appendChild(node);
    }
    dialog.append(header, bodyHost);
    // dialog の外側クリックで閉じる (背景を click target にする)
    dialog.addEventListener('click', (ev) => {
      if (ev.target === dialog) closeDialog(dialog);
    });
    dialog.addEventListener('close', () => dialog.remove());
    document.body.appendChild(dialog);
    if (typeof (dialog as HTMLDialogElement).showModal === 'function') {
      (dialog as HTMLDialogElement).showModal();
    } else {
      // showModal 非実装の場合は属性で open 状態にする
      dialog.setAttribute('open', '');
    }
  };
  return trigger;
}
