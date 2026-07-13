import { describe, expect, it } from 'vitest';
import { getListenOptions } from './listen-options.ts';

describe('getListenOptions', () => {
  it('binds no-auth mode to IPv4 loopback', () => {
    expect(getListenOptions(5185, true)).toEqual({
      port: 5185,
      hostname: '127.0.0.1',
    });
  });

  it('preserves the default bind behavior for authenticated mode', () => {
    expect(getListenOptions(5185, false)).toEqual({ port: 5185 });
  });
});
