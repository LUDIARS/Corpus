// ActionDescriptor の実行と操作コントロール描画 (Corpus DESIGN.md §13.6)。
//
// 単発 action / toggle action の API 呼出しと、 それを起動する button / switch
// の生成を担当する。 どの component に置かれるか (list card / table row /
// action-button) には関知しない。

import type { ActionDescriptor, RenderContext } from '../types.ts';
import { el } from './dom.ts';
import { applyTemplate, fillParams } from './template.ts';

export async function runAction(
  action: ActionDescriptor,
  record: Record<string, unknown>,
  ctx: RenderContext,
  toggledValue?: boolean,
): Promise<{ ok: boolean; message: string }> {
  if (action.confirm && !window.confirm(action.confirm)) {
    return { ok: false, message: '' };
  }
  const params = fillParams(action.params, record);
  let body: Record<string, unknown> | undefined;
  if (action.body) {
    body = {};
    for (const [k, v] of Object.entries(action.body)) {
      body[k] = v === '{toggled}' ? toggledValue === true : applyTemplate(v, record);
    }
  }
  try {
    const res = await ctx.data(action.dataId, { method: action.method, params, body });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, message: `失敗 (${res.status}) ${text}`.trim() };
    }
    return { ok: true, message: action.success ?? '完了しました' };
  } catch (e) {
    return { ok: false, message: `失敗: ${String(e)}` };
  }
}

export function renderActionControl(
  action: ActionDescriptor,
  record: Record<string, unknown>,
  ctx: RenderContext,
  onDone: () => void,
  setStatus: (msg: string, ok: boolean) => void,
): HTMLElement | null {
  if (action.requires === 'admin' && !ctx.identity.isAdmin) return null;

  if (action.kind === 'toggle') {
    const label = el('label', 'corpus-toggle');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = action.state
      ? applyTemplate(action.state, record).toLowerCase() === 'true' ||
        applyTemplate(action.state, record) === '1'
      : false;
    cb.onchange = async () => {
      const r = await runAction(action, record, ctx, cb.checked);
      setStatus(r.message, r.ok);
      if (r.ok) onDone();
      else cb.checked = !cb.checked; // 失敗したら戻す
    };
    label.append(cb, document.createTextNode(action.label));
    return label;
  }

  const btn = el('button', 'corpus-btn ghost', action.label);
  btn.onclick = async () => {
    btn.disabled = true;
    const r = await runAction(action, record, ctx);
    setStatus(r.message, r.ok);
    btn.disabled = false;
    if (r.ok) onDone();
  };
  return btn;
}
