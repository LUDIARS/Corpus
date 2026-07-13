// FormField → 入力コントロール描画 (Corpus DESIGN.md §13.4-2 の field 部分)。
//
// text / textarea / number / select / datetime / date / checkbox の生成と、
// select の選択肢ロード (静的 options / optionsSource) + optionDetail 表示を担当。
// form 全体の submit は components/form.ts、 一覧のインライン編集は
// components/list.ts が持つ。

import type { FormField, RenderContext } from '../types.ts';
import { el } from './dom.ts';
import { applyTemplate, extractArray } from './template.ts';

export interface FieldControl {
  node: HTMLElement;
  value(): string;
  set(v: string): void;
}

export function renderField(field: FormField, ctx: RenderContext): FieldControl {
  const wrap = el('label', 'corpus-field');
  wrap.appendChild(el('span', 'corpus-field-label', field.label));
  let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

  if (field.input === 'textarea') {
    input = el('textarea');
  } else if (field.input === 'select') {
    input = el('select');
  } else {
    const i = el('input');
    i.type = field.input === 'datetime' ? 'datetime-local'
      : field.input === 'date' ? 'date'
      : field.input === 'number' ? 'number'
      : field.input === 'checkbox' ? 'checkbox'
      : 'text';
    if (field.maxLength) i.maxLength = field.maxLength;
    input = i;
  }
  if (field.required) input.required = true;
  wrap.appendChild(input);

  const detailBox = el('div', 'corpus-field-detail');
  if (field.optionDetail) wrap.appendChild(detailBox);

  // select の選択肢
  let optionRecords: Record<string, unknown>[] = [];
  if (field.input === 'select' && field.options) {
    // 静的選択肢
    const sel = input as HTMLSelectElement;
    for (const o of field.options) {
      const opt = el('option');
      opt.value = o.value;
      opt.textContent = o.label;
      sel.appendChild(opt);
    }
  } else if (field.input === 'select' && field.optionsSource) {
    // data id から非同期ロード
    const optionsSource = field.optionsSource;
    void (async () => {
      try {
        const res = await ctx.data(optionsSource);
        optionRecords = extractArray(await res.json(), field.optionsPath);
        const sel = input as HTMLSelectElement;
        sel.innerHTML = '';
        for (const rec of optionRecords) {
          const opt = el('option');
          opt.value = String(rec[field.optionValue ?? 'id'] ?? '');
          opt.textContent = String(rec[field.optionLabel ?? 'name'] ?? opt.value);
          sel.appendChild(opt);
        }
        renderOptionDetail();
      } catch {
        // 選択肢ロード失敗 — 空のまま
      }
    })();
  }

  function renderOptionDetail(): void {
    if (!field.optionDetail) return;
    const sel = input as HTMLSelectElement;
    const rec = optionRecords.find(
      (r) => String(r[field.optionValue ?? 'id']) === sel.value,
    );
    detailBox.innerHTML = '';
    if (!rec) return;
    for (const d of field.optionDetail) {
      detailBox.appendChild(
        el('span', 'corpus-tag', `${d.label}: ${applyTemplate(d.value, rec)}`),
      );
    }
  }
  if (field.input === 'select') input.addEventListener('change', renderOptionDetail);

  return {
    node: wrap,
    value: () =>
      input instanceof HTMLInputElement && input.type === 'checkbox'
        ? String(input.checked)
        : input.value,
    set: (v) => {
      if (input instanceof HTMLInputElement && input.type === 'checkbox') {
        input.checked = v === 'true';
      } else {
        input.value = v;
      }
    },
  };
}
