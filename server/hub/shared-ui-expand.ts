// descriptor 中の `ref` を実体へ展開する (Corpus DESIGN.md §13.4-11)。
//
// **展開はサーバ側で行う。** レンダラの renderComponent は同期関数なので、
// クライアントで解決すると再帰的な非同期化がレンダラ全体へ波及する。 加えて
// ui-cache.ts の ETag は「配信した descriptor の内容」 から算出されるため、
// 展開後の内容を配信しないと参照先の変化をキャッシュが追えない。
//
// このモジュールは fetch を持たない。 引き先は resolve コールバックで注入し、
// 純粋な木の書き換えとして単体テストできるようにする。

import type { ComponentDescriptor, PanelDescriptor } from '../../public/src/render/types.ts';

/** 共通 UI エンドポイントが返す UI 片。 */
export interface SharedUiFragment {
  title?: string;
  components: ComponentDescriptor[];
}

/** キーから UI 片を引く。 見つからない・取得失敗は null。 */
export type SharedUiResolver = (key: string) => Promise<SharedUiFragment | null>;

/** 参照の入れ子の上限。 これを超えたらエラー表示に落とす。 */
export const MAX_REF_DEPTH = 8;

/**
 * 展開できなかった位置に置くエラー component。
 *
 * パネル全体を落とさず、 その位置だけ潰して周囲の描画を続ける。 共通 UI の
 * 所有サービスが落ちていても、 参照側サービスの画面が使えなくならないようにする。
 *
 * 参照側の `requires` は必ず引き継ぐ。 admin 限定の ref が展開に失敗したとき、
 * 素の text へ落とすと表示条件が外れて一般ユーザにも見えてしまうため。
 */
function refError(
  message: string,
  requires: ComponentDescriptor['requires'],
): ComponentDescriptor {
  return {
    type: 'text',
    value: message,
    tone: 'warning',
    ...(requires ? { requires } : {}),
  };
}

/**
 * PanelDescriptor 全体の ref を展開する。
 *
 * 同じキーを 1 回の展開の中で二度辿ったら循環とみなす (trail で判定)。 兄弟位置で
 * 同じキーを複数回参照するのは循環ではないので、 trail は枝ごとに分岐させる。
 */
export async function expandPanelRefs(
  descriptor: PanelDescriptor,
  resolve: SharedUiResolver,
): Promise<PanelDescriptor> {
  const sections = await Promise.all(
    descriptor.sections.map(async (section) => ({
      ...section,
      components: await expandList(section.components, resolve, [], 0),
    })),
  );
  return { ...descriptor, sections };
}

/** component 配列を展開する。 ref は 0 個以上の component に置き換わる。 */
async function expandList(
  components: readonly ComponentDescriptor[],
  resolve: SharedUiResolver,
  trail: readonly string[],
  depth: number,
): Promise<ComponentDescriptor[]> {
  const expanded = await Promise.all(
    components.map((comp) => expandOne(comp, resolve, trail, depth)),
  );
  return expanded.flat();
}

async function expandOne(
  comp: ComponentDescriptor,
  resolve: SharedUiResolver,
  trail: readonly string[],
  depth: number,
): Promise<ComponentDescriptor[]> {
  if (comp.type === 'ref') {
    return expandRef(comp.key, comp.requires, resolve, trail, depth);
  }
  return [await expandChildren(comp, resolve, trail, depth)];
}

async function expandRef(
  key: string,
  requires: ComponentDescriptor['requires'],
  resolve: SharedUiResolver,
  trail: readonly string[],
  depth: number,
): Promise<ComponentDescriptor[]> {
  if (trail.includes(key)) {
    return [refError(`共通 UI '${key}' の参照が循環しています。`, requires)];
  }
  if (depth >= MAX_REF_DEPTH) {
    return [
      refError(`共通 UI '${key}' の参照が深すぎます (上限 ${MAX_REF_DEPTH})。`, requires),
    ];
  }
  let fragment: SharedUiFragment | null;
  try {
    fragment = await resolve(key);
  } catch {
    fragment = null;
  }
  if (!fragment) {
    return [refError(`共通 UI '${key}' を取得できませんでした。`, requires)];
  }
  const children = await expandList(
    fragment.components ?? [],
    resolve,
    [...trail, key],
    depth + 1,
  );
  // ref は component 位置に置かれるので、 UI 片は section component として畳む。
  // 参照側が付けた requires は展開後の section へ引き継ぐ。
  return [
    {
      type: 'section',
      ...(fragment.title ? { title: fragment.title } : {}),
      ...(requires ? { requires } : {}),
      components: children,
    },
  ];
}

/** 子 component を持つ container 種を再帰的に展開する。 */
async function expandChildren(
  comp: ComponentDescriptor,
  resolve: SharedUiResolver,
  trail: readonly string[],
  depth: number,
): Promise<ComponentDescriptor> {
  switch (comp.type) {
    case 'section':
    case 'grid':
    case 'stack':
    case 'modal':
      return { ...comp, components: await expandList(comp.components, resolve, trail, depth) };
    case 'tabs':
      return {
        ...comp,
        tabs: await Promise.all(
          comp.tabs.map(async (tab) => ({
            ...tab,
            components: await expandList(tab.components, resolve, trail, depth),
          })),
        ),
      };
    case 'dock':
      return {
        ...comp,
        panels: await Promise.all(
          comp.panels.map(async (panel) => ({
            ...panel,
            components: await expandList(panel.components, resolve, trail, depth),
          })),
        ),
      };
    default:
      return comp;
  }
}

/** PanelDescriptor らしき JSON か。 展開対象の判定に使う。 */
export function isPanelDescriptor(value: unknown): value is PanelDescriptor {
  if (!value || typeof value !== 'object') return false;
  const o = value as Record<string, unknown>;
  return typeof o.title === 'string' && Array.isArray(o.sections);
}
