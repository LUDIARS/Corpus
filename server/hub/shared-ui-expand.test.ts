// 共通 UI 参照 (§13.4-11) の展開。
//
// resolve を差し替えられる純関数なので、 HTTP を立てずに木の書き換えだけを検証する。

import { describe, expect, it, vi } from 'vitest';
import {
  MAX_REF_DEPTH,
  expandPanelRefs,
  isPanelDescriptor,
  type SharedUiFragment,
} from './shared-ui-expand.ts';
import type { ComponentDescriptor, PanelDescriptor } from '../../public/src/render/types.ts';

function panel(components: ComponentDescriptor[]): PanelDescriptor {
  return { descriptorVersion: 1, title: 'P', sections: [{ components }] };
}

function resolverOf(map: Record<string, SharedUiFragment>) {
  return vi.fn(async (key: string) => map[key] ?? null);
}

/** sections[0].components を取り出す (noUncheckedIndexedAccess 対策)。 */
function comps(p: PanelDescriptor): ComponentDescriptor[] {
  const section = p.sections[0];
  if (!section) throw new Error('sections[0] が無い');
  return section.components;
}

/** components[i] を型付きで取り出す。 */
function at(list: readonly ComponentDescriptor[], i: number): ComponentDescriptor {
  const c = list[i];
  if (!c) throw new Error(`components[${i}] が無い`);
  return c;
}

describe('expandPanelRefs', () => {
  it('replaces a ref with a section carrying the fragment title and components', async () => {
    const resolve = resolverOf({
      'cernere-auth-settings': {
        title: 'Cernere 設定 (認証設定)',
        components: [{ type: 'text', value: 'パスキー' }],
      },
    });
    const out = await expandPanelRefs(
      panel([{ type: 'ref', key: 'cernere-auth-settings' }]),
      resolve,
    );
    expect(comps(out)).toEqual([
      {
        type: 'section',
        title: 'Cernere 設定 (認証設定)',
        components: [{ type: 'text', value: 'パスキー' }],
      },
    ]);
  });

  it('carries the referring side requires onto the expanded section', async () => {
    const resolve = resolverOf({ k: { components: [] } });
    const out = await expandPanelRefs(
      panel([{ type: 'ref', key: 'k', requires: 'admin' }]),
      resolve,
    );
    expect(at(comps(out), 0)).toMatchObject({
      type: 'section',
      requires: 'admin',
    });
  });

  it('expands refs nested inside container components', async () => {
    const resolve = resolverOf({ k: { components: [{ type: 'text', value: 'deep' }] } });
    const out = await expandPanelRefs(
      panel([
        {
          type: 'tabs',
          tabs: [{ label: 'T', components: [{ type: 'ref', key: 'k' }] }],
        },
      ]),
      resolve,
    );
    const tabs = at(comps(out), 0) as ComponentDescriptor & { type: 'tabs' };
    const tab = tabs.tabs[0];
    if (!tab) throw new Error('tabs[0] が無い');
    expect(at(tab.components, 0)).toMatchObject({
      type: 'section',
      components: [{ type: 'text', value: 'deep' }],
    });
  });

  it('expands a ref that appears inside another fragment', async () => {
    const resolve = resolverOf({
      outer: { components: [{ type: 'ref', key: 'inner' }] },
      inner: { components: [{ type: 'text', value: 'innermost' }] },
    });
    const out = await expandPanelRefs(panel([{ type: 'ref', key: 'outer' }]), resolve);
    const outer = at(comps(out), 0) as ComponentDescriptor & { type: 'section' };
    const inner = at(outer.components, 0) as ComponentDescriptor & { type: 'section' };
    expect(inner.components).toEqual([{ type: 'text', value: 'innermost' }]);
  });

  it('detects a cycle and degrades only that position', async () => {
    const resolve = resolverOf({
      a: { components: [{ type: 'ref', key: 'b' }] },
      b: { components: [{ type: 'ref', key: 'a' }] },
    });
    const out = await expandPanelRefs(
      panel([{ type: 'ref', key: 'a' }, { type: 'text', value: 'survivor' }]),
      resolve,
    );
    // 循環した枝はエラー表示に落ちるが、 兄弟の component は残る
    expect(JSON.stringify(out)).toContain('循環');
    expect(at(comps(out), 1)).toEqual({ type: 'text', value: 'survivor' });
  });

  it('allows the same key twice as siblings (not a cycle)', async () => {
    const resolve = resolverOf({ k: { components: [{ type: 'text', value: 'x' }] } });
    const out = await expandPanelRefs(
      panel([{ type: 'ref', key: 'k' }, { type: 'ref', key: 'k' }]),
      resolve,
    );
    expect(JSON.stringify(out)).not.toContain('循環');
    expect(comps(out)).toHaveLength(2);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('degrades an unresolved key without throwing', async () => {
    const out = await expandPanelRefs(
      panel([{ type: 'ref', key: 'nope' }]),
      resolverOf({}),
    );
    expect(JSON.stringify(out)).toContain('nope');
    expect(at(comps(out), 0)).toMatchObject({ type: 'text', tone: 'warning' });
  });

  it('keeps requires on the degraded component so admin-only refs stay hidden', async () => {
    // 素の text へ落とすと表示条件が外れ、 admin 限定の案内が一般ユーザに見える
    const out = await expandPanelRefs(
      panel([{ type: 'ref', key: 'nope', requires: 'admin' }]),
      resolverOf({}),
    );
    expect(at(comps(out), 0)).toMatchObject({
      type: 'text',
      tone: 'warning',
      requires: 'admin',
    });
  });

  it('keeps requires when a cycle collapses the referring position', async () => {
    // a → a の自己循環。 内側の ref が admin 限定なら、 潰れた text も admin 限定。
    const resolve = resolverOf({
      a: { components: [{ type: 'ref', key: 'a', requires: 'admin' }] },
    });
    const out = await expandPanelRefs(panel([{ type: 'ref', key: 'a' }]), resolve);
    const outer = at(comps(out), 0) as ComponentDescriptor & { type: 'section' };
    expect(at(outer.components, 0)).toMatchObject({
      type: 'text',
      tone: 'warning',
      requires: 'admin',
    });
  });

  it('degrades when the resolver throws', async () => {
    const resolve = vi.fn(async () => {
      throw new Error('upstream down');
    });
    const out = await expandPanelRefs(panel([{ type: 'ref', key: 'k' }]), resolve);
    expect(at(comps(out), 0)).toMatchObject({ type: 'text', tone: 'warning' });
  });

  it('stops at the depth limit', async () => {
    // 毎回別キーを返し続ける = 循環しないまま無限に深くなる参照鎖
    const resolve = vi.fn(async (key: string) => ({
      components: [{ type: 'ref', key: `${key}+` } as ComponentDescriptor],
    }));
    const out = await expandPanelRefs(panel([{ type: 'ref', key: 'k' }]), resolve);
    expect(JSON.stringify(out)).toContain('深すぎます');
    expect(resolve).toHaveBeenCalledTimes(MAX_REF_DEPTH);
  });

  it('leaves descriptors without refs untouched', async () => {
    const resolve = resolverOf({});
    const input = panel([{ type: 'text', value: 'plain' }]);
    const out = await expandPanelRefs(input, resolve);
    expect(out).toEqual(input);
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe('isPanelDescriptor', () => {
  it('accepts a descriptor and rejects other JSON', () => {
    expect(isPanelDescriptor(panel([]))).toBe(true);
    expect(isPanelDescriptor({ title: 'x' })).toBe(false);
    expect(isPanelDescriptor([1, 2, 3])).toBe(false);
    expect(isPanelDescriptor(null)).toBe(false);
  });
});
