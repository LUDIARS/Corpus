// @vitest-environment jsdom
//
// updatePaginationState の終端判定 (§13.4-1 / -4)。
//
// 分割前は list / table が同じ判定を各々インラインで持っていた。 共有化した今は
// ここが両者唯一の終端判定なので、 分岐 (totalPath 有無 / stopWhenEmpty) を直接押さえる。

import { describe, expect, it } from 'vitest';
import type { PaginationSpec } from '../types.ts';
import { type PaginationState, updatePaginationState } from './pagination.ts';

function state(page: number): PaginationState {
  return { page, isLast: false, total: null };
}

describe('updatePaginationState', () => {
  describe('totalPath がある場合', () => {
    const spec: PaginationSpec = { pageSize: 2, totalPath: 'meta.total' };

    it('総ページ数未満なら継続', () => {
      const s = state(1);
      updatePaginationState(spec, s, { meta: { total: 5 } }, 2);
      expect(s.total).toBe(5);
      expect(s.isLast).toBe(false);
    });

    it('最終ページに達したら終端 (端数あり)', () => {
      const s = state(3); // ceil(5/2) = 3
      updatePaginationState(spec, s, { meta: { total: 5 } }, 1);
      expect(s.isLast).toBe(true);
    });

    it('total=0 でも 1 ページ目を終端として扱う', () => {
      const s = state(1); // max(1, ceil(0/2)) = 1
      updatePaginationState(spec, s, { meta: { total: 0 } }, 0);
      expect(s.total).toBe(0);
      expect(s.isLast).toBe(true);
    });

    it('件数が満杯でも total 基準を優先する', () => {
      const s = state(2); // ceil(4/2) = 2
      updatePaginationState(spec, s, { meta: { total: 4 } }, 2);
      expect(s.isLast).toBe(true);
    });

    it('total が数値でなければ stopWhenEmpty 判定にフォールバック', () => {
      const s = state(1);
      updatePaginationState(spec, s, { meta: { total: 'many' } }, 2);
      expect(s.total).toBeNull();
      expect(s.isLast).toBe(false); // 満杯なので継続
    });
  });

  describe('totalPath が無い場合 (stopWhenEmpty)', () => {
    const spec: PaginationSpec = { pageSize: 2 };

    it('既定 (true) で pageSize 未満なら終端', () => {
      const s = state(1);
      updatePaginationState(spec, s, [{}], 1);
      expect(s.total).toBeNull();
      expect(s.isLast).toBe(true);
    });

    it('既定 (true) で pageSize 丁度なら継続', () => {
      const s = state(1);
      updatePaginationState(spec, s, [{}, {}], 2);
      expect(s.isLast).toBe(false);
    });

    it('stopWhenEmpty=false なら件数不足でも継続', () => {
      const s = state(1);
      updatePaginationState({ ...spec, stopWhenEmpty: false }, s, [], 0);
      expect(s.isLast).toBe(false);
    });
  });

  it('再判定で isLast が false に戻る (前ページへ戻った場合)', () => {
    const spec: PaginationSpec = { pageSize: 2, totalPath: 'meta.total' };
    const s = state(3);
    updatePaginationState(spec, s, { meta: { total: 5 } }, 1);
    expect(s.isLast).toBe(true);
    s.page = 1;
    updatePaginationState(spec, s, { meta: { total: 5 } }, 2);
    expect(s.isLast).toBe(false);
  });
});
