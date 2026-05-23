// @vitest-environment jsdom
//
// Layouter component (grid / stack) の挙動を検証する.
// jsdom は @media query を評価しないので、 inline CSS variables と class
// (.responsive 等) が正しく付与されることで「PC / スマホ両対応」 が成立する
// ことだけ確認する. 実際の画面切替は CSS 側で完結する設計.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPanel } from './renderer.ts';
import type { PanelDescriptor, RenderContext } from './types.ts';

function makeCtx(opts?: { isAdmin?: boolean }): RenderContext {
  return {
    identity: {
      userId: 'u1',
      displayName: 'tester',
      isAdmin: opts?.isAdmin ?? false,
    },
    async data() {
      return new Response('[]', { status: 200 });
    },
  };
}

function mount(): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return host;
}

async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
  await new Promise<void>((r) => setTimeout(r, 0));
}

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { vi.restoreAllMocks(); });

// ── grid ───────────────────────────────────────────────────────────────────

describe('grid layouter', () => {
  it('sets --corpus-cols / --corpus-mobile-cols inline variables', async () => {
    const host = mount();
    const desc: PanelDescriptor = {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'grid', columns: 3, mobileColumns: 1,
        components: [
          { type: 'stat', label: 'A', dataSource: 'x' },
          { type: 'stat', label: 'B', dataSource: 'x' },
          { type: 'stat', label: 'C', dataSource: 'x' },
        ],
      }] }],
    };
    renderPanel(host, desc, makeCtx());
    await flush();

    const grid = host.querySelector<HTMLElement>('.corpus-grid')!;
    expect(grid).toBeTruthy();
    expect(grid.style.getPropertyValue('--corpus-cols')).toBe('3');
    expect(grid.style.getPropertyValue('--corpus-mobile-cols')).toBe('1');
    // 3 児が描かれている
    expect(grid.querySelectorAll('.corpus-stat')).toHaveLength(3);
  });

  it('defaults mobileColumns to 1 when omitted', async () => {
    const host = mount();
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'grid', columns: 2,
        components: [],
      }] }],
    }, makeCtx());
    await flush();
    const grid = host.querySelector<HTMLElement>('.corpus-grid')!;
    expect(grid.style.getPropertyValue('--corpus-cols')).toBe('2');
    expect(grid.style.getPropertyValue('--corpus-mobile-cols')).toBe('1');
  });

  it('sets --corpus-gap when specified', async () => {
    const host = mount();
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'grid', columns: 2, gap: 1.2,
        components: [],
      }] }],
    }, makeCtx());
    await flush();
    const grid = host.querySelector<HTMLElement>('.corpus-grid')!;
    expect(grid.style.getPropertyValue('--corpus-gap')).toBe('1.2rem');
  });

  it('hides grid when requires=admin and not admin', () => {
    const host = mount();
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'grid', columns: 2, requires: 'admin',
        components: [],
      }] }],
    }, makeCtx({ isAdmin: false }));
    expect(host.querySelector('.corpus-grid')).toBeNull();
  });

  it('skips admin-only children inside non-admin grid', async () => {
    const host = mount();
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'grid', columns: 2,
        components: [
          { type: 'stat', label: 'public', dataSource: 'x' },
          { type: 'stat', label: 'secret', dataSource: 'x', requires: 'admin' },
        ],
      }] }],
    }, makeCtx({ isAdmin: false }));
    await flush();
    const stats = host.querySelectorAll('.corpus-stat-label');
    expect(stats).toHaveLength(1);
    expect(stats[0].textContent).toBe('public');
  });
});

// ── stack ──────────────────────────────────────────────────────────────────

describe('stack layouter', () => {
  it('defaults to responsive=true (class .responsive) with row direction', async () => {
    const host = mount();
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'stack',
        components: [
          { type: 'stat', label: 'A', dataSource: 'x' },
          { type: 'stat', label: 'B', dataSource: 'x' },
        ],
      }] }],
    }, makeCtx());
    await flush();
    const stack = host.querySelector<HTMLElement>('.corpus-stack')!;
    expect(stack).toBeTruthy();
    expect(stack.classList.contains('responsive')).toBe(true);
    expect(stack.style.getPropertyValue('--corpus-direction')).toBe('row');
    expect(stack.querySelectorAll('.corpus-stat')).toHaveLength(2);
  });

  it('responsive=false omits the class (no auto reflow)', async () => {
    const host = mount();
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'stack', responsive: false,
        components: [],
      }] }],
    }, makeCtx());
    await flush();
    const stack = host.querySelector<HTMLElement>('.corpus-stack')!;
    expect(stack.classList.contains('responsive')).toBe(false);
  });

  it('direction=column sets --corpus-direction:column', async () => {
    const host = mount();
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'stack', direction: 'column',
        components: [],
      }] }],
    }, makeCtx());
    await flush();
    const stack = host.querySelector<HTMLElement>('.corpus-stack')!;
    expect(stack.style.getPropertyValue('--corpus-direction')).toBe('column');
  });

  it('wrap=false sets --corpus-wrap:nowrap', async () => {
    const host = mount();
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'stack', wrap: false,
        components: [],
      }] }],
    }, makeCtx());
    await flush();
    const stack = host.querySelector<HTMLElement>('.corpus-stack')!;
    expect(stack.style.getPropertyValue('--corpus-wrap')).toBe('nowrap');
  });

  it('custom gap sets --corpus-gap', async () => {
    const host = mount();
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'stack', gap: 0.3,
        components: [],
      }] }],
    }, makeCtx());
    await flush();
    const stack = host.querySelector<HTMLElement>('.corpus-stack')!;
    expect(stack.style.getPropertyValue('--corpus-gap')).toBe('0.3rem');
  });

  it('hides stack entirely when requires=admin and not admin', () => {
    const host = mount();
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'stack', requires: 'admin',
        components: [],
      }] }],
    }, makeCtx({ isAdmin: false }));
    expect(host.querySelector('.corpus-stack')).toBeNull();
  });
});

// ── nested layouter ────────────────────────────────────────────────────────

describe('nested layouters', () => {
  it('grid > stack composes (children of stack inside a grid cell)', async () => {
    const host = mount();
    renderPanel(host, {
      descriptorVersion: 1, title: 'P',
      sections: [{ components: [{
        type: 'grid', columns: 2,
        components: [
          {
            type: 'stack', direction: 'column', responsive: false,
            components: [
              { type: 'stat', label: 'A1', dataSource: 'x' },
              { type: 'stat', label: 'A2', dataSource: 'x' },
            ],
          },
          { type: 'stat', label: 'B', dataSource: 'x' },
        ],
      }] }],
    }, makeCtx());
    await flush();
    const grid = host.querySelector<HTMLElement>('.corpus-grid')!;
    expect(grid).toBeTruthy();
    // grid 内に stack が 1 つ
    const stacks = grid.querySelectorAll('.corpus-stack');
    expect(stacks).toHaveLength(1);
    // stack 内に stat 2 つ
    expect(stacks[0].querySelectorAll('.corpus-stat')).toHaveLength(2);
    // grid 直下の stat (B) も別途
    const labels = Array.from(grid.querySelectorAll('.corpus-stat-label')).map((n) => n.textContent);
    expect(labels).toEqual(['A1', 'A2', 'B']);
  });
});

// ── style.css sanity (single source of breakpoint) ────────────────────────

describe('style.css responsive contract', () => {
  it('media query @640px appears in style.css for both grid and stack', async () => {
    // style.css は別経路 (esbuild bundling 外) の素 CSS なので、 ファイル内容を直接読む。
    // node fetch ではなく、 vite/vitest が同期で読めるよう URL 経由ではなく fs で読む。
    const fs = await import('node:fs/promises');
    const css = await fs.readFile('public/style.css', 'utf-8');
    // grid と stack の両方が同じ breakpoint (640px) を共有していること
    const at640 = css.match(/@media \(min-width: 640px\)/g) ?? [];
    expect(at640.length).toBeGreaterThanOrEqual(2);
    expect(css).toMatch(/\.corpus-grid[\s\S]*grid-template-columns/);
    expect(css).toMatch(/\.corpus-stack\.responsive/);
  });
});
