// DOM 生成の最小ヘルパ (corpus-renderer 内部共通)。
//
// renderer 全 component が使う createElement ラッパと status 行のみを持つ。
// テンプレート束縛 (文字列 → 値) は template.ts が担当。

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

export function makeStatus(): { node: HTMLElement; set: (m: string, ok: boolean) => void } {
  const node = el('p', 'corpus-status');
  return {
    node,
    set: (m, ok) => {
      node.textContent = m;
      node.className = `corpus-status ${ok ? 'ok' : 'err'}`;
    },
  };
}
