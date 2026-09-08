import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CleanupScope } from './lifecycle.ts';

describe('Corpus host cleanup contract', () => {
  it('continues after cleanup failure, in reverse order, exactly once', async () => {
    const scope = new CleanupScope();
    const order: string[] = [];
    scope.defer(() => { order.push('db'); });
    scope.defer(() => { order.push('client'); throw new Error('close failed'); });
    scope.defer(async () => { order.push('http'); });
    const first = scope.close();
    expect(scope.close()).toBe(first);
    await expect(first).rejects.toBeInstanceOf(AggregateError);
    expect(order).toEqual(['http', 'client', 'db']);
    expect(() => scope.defer(() => {})).toThrow('cleanup already started');
  });

  it('has no detached startup or hard exit in embedding entrypoints', () => {
    for (const file of ['index.ts', 'bootstrap-runtime.ts', 'bootstrap.ts']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(source).not.toMatch(/process\.exit\s*\(/);
      expect(source).not.toMatch(/void main\s*\(/);
    }
  });
});
