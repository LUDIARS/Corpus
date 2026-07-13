// form component (Corpus DESIGN.md §13.4-2)。
//
// field 群の組立てと submit (manifest data への POST 等) を担当する。
// 個々の入力コントロール生成は internal/fields.ts。

import type { ComponentDescriptor, FormField, RenderContext } from '../types.ts';
import { el, makeStatus } from '../internal/dom.ts';
import { type FieldControl, renderField } from '../internal/fields.ts';

export function renderForm(
  comp: ComponentDescriptor & { type: 'form' },
  ctx: RenderContext,
): HTMLElement {
  const wrap = el('div', 'corpus-form-wrap');
  const form = el('form', 'corpus-form');
  const status = makeStatus();
  const controls: { field: FormField; ctrl: FieldControl }[] = [];
  for (const field of comp.fields) {
    const ctrl = renderField(field, ctx);
    controls.push({ field, ctrl });
    form.appendChild(ctrl.node);
  }
  const submit = el('button', 'corpus-btn primary', '送信');
  form.appendChild(submit);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body: Record<string, unknown> = {};
    for (const { field, ctrl } of controls) body[field.name] = ctrl.value();
    submit.disabled = true;
    try {
      const res = await ctx.data(comp.submit.dataId, { method: comp.submit.method, body });
      if (!res.ok) {
        status.set(`失敗 (${res.status})`, false);
      } else {
        status.set(comp.submit.success ?? '送信しました', true);
        form.reset();
      }
    } catch (err) {
      status.set(`失敗: ${String(err)}`, false);
    } finally {
      submit.disabled = false;
    }
  };
  wrap.append(form, status.node);
  return wrap;
}
