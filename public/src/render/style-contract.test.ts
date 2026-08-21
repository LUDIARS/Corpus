// style.css の breakpoint 契約。
//
// renderer-layouter.test.ts から分離した。 あちらは環境 pragma で jsdom に切り替えて
// おり、 jsdom 下では node:fs/promises が実体を持たず readFile が呼べない。 ファイル
// 内容を読むだけの契約検査に DOM は要らないので、 既定の node 環境で回す。
//
// このファイルのコメントに環境 pragma の文字列を書いてはいけない。 vitest は本文中の
// 出現も拾うため、 コメントで言及しただけで jsdom が適用され、 同じ理由で落ちる。

import { describe, expect, it } from 'vitest';

describe('style.css responsive contract', () => {
  it('media query @640px appears in style.css for both grid and stack', async () => {
    // style.css は esbuild の bundling 外にある素の CSS なので、内容を直接読む。
    // node builtin は動的 import で取る。 このディレクトリの test は frontend 向けに
    // 変換されるため、 静的な名前付き import では束縛されない (readFile が undefined)。
    const { readFile } = await import('node:fs/promises');
    const css = await readFile(new URL('../../style.css', import.meta.url), 'utf-8');
    // grid と stack の desktop 規則が同じ breakpoint (640px) に入っていること。
    expect(css).toMatch(
      /@media \(min-width: 640px\)\s*{\s*\.corpus-grid\s*{[^}]*grid-template-columns/,
    );
    expect(css).toMatch(
      /@media \(min-width: 640px\)\s*{\s*\.corpus-stack\.responsive\s*{[^}]*flex-direction/,
    );
  });

  it('text component tones are declared in style.css', async () => {
    const { readFile } = await import('node:fs/promises');
    const css = await readFile(new URL('../../style.css', import.meta.url), 'utf-8');
    // renderer が付けるクラスと style.css の宣言がずれると無地の文字列になる。
    expect(css).toMatch(/\.corpus-text\s*{/);
    expect(css).toMatch(/\.corpus-text--muted\s*{/);
    expect(css).toMatch(/\.corpus-text--warning\s*{/);
  });
});
