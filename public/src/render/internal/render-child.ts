// コンテナ component (modal / grid / stack / dock / section / tabs) が子を描く
// ための注入型。 dispatch.ts が renderComponent を実体として渡す。
// (components → dispatch の逆 import を作らず、 依存方向を dispatch → components
//  → internal の一方向に保つための間接。)

import type { ComponentDescriptor, RenderContext } from '../types.ts';

export type RenderChild = (
  comp: ComponentDescriptor,
  ctx: RenderContext,
) => HTMLElement | null;
