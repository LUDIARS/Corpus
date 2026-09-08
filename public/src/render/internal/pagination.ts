// pagination の状態と操作バー (list / table 共用)。
//
// dataSource へのページ番号/件数パラメタ生成、 total 読取、 前へ/次へバーの
// 描画のみを担当する。 データ取得と再描画は呼び元 component が持つ。

import type { PaginationSpec } from '../types.ts';
import { el } from './dom.ts';
import { getByPath } from './template.ts';

export interface PaginationState {
  page: number;
  isLast: boolean;
  total: number | null;
}

export function paginationParams(spec: PaginationSpec, page: number): Record<string, string> {
  const out: Record<string, string> = {};
  out[spec.pageParam ?? 'page'] = String(page);
  if (spec.limitParam !== undefined) out[spec.limitParam] = String(spec.pageSize);
  return out;
}

export function readTotal(json: unknown, path?: string): number | null {
  if (!path) return null;
  const v = getByPath(json, path);
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

/** 取得済みページの内容から isLast / total を更新する (list / table 共通の終端判定)。 */
export function updatePaginationState(
  spec: PaginationSpec,
  state: PaginationState,
  json: unknown,
  itemCount: number,
): void {
  state.total = readTotal(json, spec.totalPath);
  // total があれば終端判定、 無ければ stopWhenEmpty (既定 true) で「次が空なら最終」
  if (state.total != null) {
    state.isLast = state.page >= Math.max(1, Math.ceil(state.total / spec.pageSize));
  } else if ((spec.stopWhenEmpty ?? true) && itemCount < spec.pageSize) {
    state.isLast = true;
  } else {
    state.isLast = false;
  }
}

export function renderPaginationBar(
  spec: PaginationSpec,
  state: PaginationState,
  onJump: (page: number) => void,
): HTMLElement {
  const bar = el('div', 'corpus-pagination');
  const prev = el('button', 'corpus-btn ghost', '前へ');
  prev.disabled = state.page <= (spec.startPage ?? 1);
  prev.onclick = () => onJump(state.page - 1);

  const labelText = state.total != null
    ? `${state.page} / ${Math.max(1, Math.ceil(state.total / spec.pageSize))} (計 ${state.total})`
    : `ページ ${state.page}`;
  const label = el('span', 'corpus-pagination-label', labelText);

  const next = el('button', 'corpus-btn ghost', '次へ');
  next.disabled = state.isLast;
  next.onclick = () => onJump(state.page + 1);

  bar.append(prev, label, next);
  return bar;
}
