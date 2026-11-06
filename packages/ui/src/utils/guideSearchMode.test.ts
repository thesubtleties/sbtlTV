import { describe, it, expect, beforeEach } from 'vitest';
import { loadGuideSearchMode, saveGuideSearchMode } from './guideSearchMode';

describe('guide search mode', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) };
  });
  it('defaults to search and remembers the choice', () => {
    expect(loadGuideSearchMode()).toBe('search');
    saveGuideSearchMode('filter');
    expect(loadGuideSearchMode()).toBe('filter');
  });
  it('falls back to search on junk or when storage throws', () => {
    localStorage.setItem('guide-search-mode', 'nope');
    expect(loadGuideSearchMode()).toBe('search');
    (globalThis as Record<string, unknown>).localStorage = { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); } };
    expect(loadGuideSearchMode()).toBe('search');
    expect(() => saveGuideSearchMode('filter')).not.toThrow();
  });
});
