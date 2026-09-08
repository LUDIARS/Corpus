// hub 側で展開できなかった共通UI参照 (DESIGN.md §13.4-11)。周囲の描画を続ける。
import type { RefComponent } from '../types.ts';
import { el } from '../internal/dom.ts';

export function renderUnresolvedRef(comp: RefComponent): HTMLElement {
  return el('p', 'corpus-error', `共通 UI '${comp.key}' を解決できませんでした。`);
}
