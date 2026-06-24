import { describe, it, expect } from 'vitest';
import {
  PassthroughTokenProvider,
  CernereProjectTokenProvider,
  makeTokenProvider,
} from './tokens.ts';

const target = { service: 'x', projectKey: 'x', baseUrl: 'http://localhost:9999' };

describe('PassthroughTokenProvider', () => {
  it('受信トークンをそのまま返す', async () => {
    const tp = new PassthroughTokenProvider();
    expect(tp.mode).toBe('passthrough');
    expect(await tp.getDownstreamToken('tok-123', target)).toBe('tok-123');
    expect(await tp.getDownstreamToken(null, target)).toBeNull();
  });
});

describe('makeTokenProvider', () => {
  it('明示された env 値でモードを選ぶ', () => {
    expect(makeTokenProvider('passthrough', 'http://c').mode).toBe('passthrough');
    expect(makeTokenProvider('cernere-project-token', 'http://c').mode).toBe(
      'cernere-project-token',
    );
  });

  it('前後空白を許容する', () => {
    expect(makeTokenProvider('  passthrough  ', 'http://c').mode).toBe(
      'passthrough',
    );
    expect(makeTokenProvider(' cernere-project-token ', 'http://c').mode).toBe(
      'cernere-project-token',
    );
  });

  it('未設定は throw する (無言フォールバック禁止)', () => {
    expect(() => makeTokenProvider(undefined, 'http://c')).toThrow(
      /CORPUS_TOKEN_MODE/,
    );
    expect(() => makeTokenProvider('', 'http://c')).toThrow(/CORPUS_TOKEN_MODE/);
    expect(() => makeTokenProvider('   ', 'http://c')).toThrow(
      /CORPUS_TOKEN_MODE/,
    );
  });

  it('dev 無認証経路 (allowImplicitPassthrough) のときだけ未設定で passthrough', () => {
    expect(
      makeTokenProvider(undefined, 'http://c', {
        allowImplicitPassthrough: true,
      }).mode,
    ).toBe('passthrough');
  });

  it('未知の値は dev でも throw する', () => {
    expect(() => makeTokenProvider('bogus', 'http://c')).toThrow(/不正/);
    expect(() =>
      makeTokenProvider('bogus', 'http://c', { allowImplicitPassthrough: true }),
    ).toThrow(/不正/);
  });
});

describe('CernereProjectTokenProvider', () => {
  it('受信トークンが無ければ null', async () => {
    const tp = new CernereProjectTokenProvider('http://127.0.0.1:9');
    expect(tp.mode).toBe('cernere-project-token');
    expect(await tp.getDownstreamToken(null, target)).toBeNull();
  });

  it('Cernere 不達なら null (throw しない)', async () => {
    const tp = new CernereProjectTokenProvider('http://127.0.0.1:9');
    expect(await tp.getDownstreamToken('user-token', target)).toBeNull();
  });
});
