import { describe, it, expect } from 'vitest';
import {
  openDb,
  resolveExternalId,
  listExternalIdMappings,
  reassignExternalId,
  cacheDisplayName,
  getDisplayName,
} from './db.ts';

describe('external-id mapping', () => {
  it('resolveExternalId は get-or-create で安定', () => {
    const db = openDb(':memory:');
    const a = resolveExternalId(db, 'iss', 'sub-1');
    const b = resolveExternalId(db, 'iss', 'sub-1');
    expect(a).toBe(b);
    const c = resolveExternalId(db, 'iss', 'sub-2');
    expect(c).not.toBe(a);
    db.close();
  });

  it('reassignExternalId は (issuer,sub) を target へ張り替える', () => {
    const db = openDb(':memory:');
    const eid1 = resolveExternalId(db, 'iss', 'sub-1');
    resolveExternalId(db, 'iss', 'sub-2');
    expect(reassignExternalId(db, 'iss', 'sub-2', eid1)).toBe(true);
    expect(resolveExternalId(db, 'iss', 'sub-2')).toBe(eid1);
    // 存在しない (issuer,sub) は false
    expect(reassignExternalId(db, 'iss', 'nope', eid1)).toBe(false);
    db.close();
  });

  it('listExternalIdMappings は全件返す', () => {
    const db = openDb(':memory:');
    resolveExternalId(db, 'iss', 's1');
    resolveExternalId(db, 'iss', 's2');
    expect(listExternalIdMappings(db)).toHaveLength(2);
    db.close();
  });
});

describe('display name cache', () => {
  it('表示名をキャッシュ / 取得 / 上書きする', () => {
    const db = openDb(':memory:');
    expect(getDisplayName(db, 'u1')).toBeNull();
    cacheDisplayName(db, 'u1', 'Alice');
    expect(getDisplayName(db, 'u1')).toBe('Alice');
    cacheDisplayName(db, 'u1', 'Alice 2');
    expect(getDisplayName(db, 'u1')).toBe('Alice 2');
    db.close();
  });
});
