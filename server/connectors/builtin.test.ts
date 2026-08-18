import { afterEach, describe, expect, it } from 'vitest';
import { getCorpusDisplayName, SelfConnector } from './builtin.ts';

const originalDisplayName = process.env.CORPUS_DISPLAY_NAME;

afterEach(() => {
  if (originalDisplayName === undefined) delete process.env.CORPUS_DISPLAY_NAME;
  else process.env.CORPUS_DISPLAY_NAME = originalDisplayName;
});

describe('getCorpusDisplayName', () => {
  it('未設定または空白だけなら既定の Corpus を使う', () => {
    delete process.env.CORPUS_DISPLAY_NAME;
    expect(getCorpusDisplayName()).toBe('Corpus');

    process.env.CORPUS_DISPLAY_NAME = '   ';
    expect(getCorpusDisplayName()).toBe('Corpus');
  });

  it('設定値を trim し、自己コネクタにも同じ名前を使う', () => {
    process.env.CORPUS_DISPLAY_NAME = ' GLab-Hub ';

    expect(getCorpusDisplayName()).toBe('GLab-Hub');
    expect(new SelfConnector().title).toBe('GLab-Hub');
  });
});
