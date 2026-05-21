import { describe, it, expect } from 'vitest';
import { normalizeManifest } from './manifest.ts';
import type { CorpusServiceManifest } from './manifest.ts';

describe('normalizeManifest', () => {
  it('service が欠ければ null', () => {
    expect(normalizeManifest(null)).toBeNull();
    expect(normalizeManifest(undefined)).toBeNull();
    expect(normalizeManifest({})).toBeNull();
    expect(normalizeManifest({ displayName: 'X' })).toBeNull();
  });

  it('最小マニフェストに既定値を充填する', () => {
    const m = normalizeManifest({ service: 'bib' });
    expect(m).not.toBeNull();
    expect(m?.service).toBe('bib');
    expect(m?.displayName).toBe('bib');
    expect(m?.corpusApi).toBe(1);
    expect(m?.health).toBe('/api/health');
    expect(m?.data).toEqual([]);
    expect(m?.panels).toEqual([]);
    expect(m?.auth).toBe('none');
    expect(m?.cernereProjectKey).toBe('bib');
  });

  it('壊れた data / panel エントリを除去する', () => {
    const raw = {
      service: 'x',
      data: [
        { id: 'a', path: '/a', scope: 'multi' },
        { id: 'bad' },
        null,
      ],
      panels: [{ id: 'p', title: 'P', entry: 'p.js' }, { id: 'noentry' }],
    } as unknown as Partial<CorpusServiceManifest>;
    const m = normalizeManifest(raw);
    expect(m?.data).toHaveLength(1);
    expect(m?.data[0]?.id).toBe('a');
    expect(m?.panels).toHaveLength(1);
    expect(m?.panels[0]?.id).toBe('p');
  });
});
