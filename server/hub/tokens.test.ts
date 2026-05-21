import { describe, it, expect } from 'vitest';
import {
  PassthroughTokenProvider,
  CernereProjectTokenProvider,
  makeTokenProvider,
} from './tokens.ts';

const target = { service: 'x', projectKey: 'x' };

describe('PassthroughTokenProvider', () => {
  it('受信トークンをそのまま返す', async () => {
    const tp = new PassthroughTokenProvider();
    expect(tp.mode).toBe('passthrough');
    expect(await tp.getDownstreamToken('tok-123', target)).toBe('tok-123');
    expect(await tp.getDownstreamToken(null, target)).toBeNull();
  });
});

describe('makeTokenProvider', () => {
  it('env 値でモードを選ぶ', () => {
    expect(makeTokenProvider(undefined, 'http://c').mode).toBe('passthrough');
    expect(makeTokenProvider('passthrough', 'http://c').mode).toBe('passthrough');
    expect(makeTokenProvider('cernere-project-token', 'http://c').mode).toBe(
      'cernere-project-token',
    );
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
