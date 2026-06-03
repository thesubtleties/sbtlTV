import { describe, it, expect } from 'vitest';
import { sortCategoryGroups, resolveGroupPrimary, type CategorySortable } from './categorySort';

function g(name: string, primaryPriority: number, primaryPosition: number): CategorySortable {
  return { name, primaryPriority, primaryPosition };
}

describe('sortCategoryGroups', () => {
  it('alphabetical mode sorts by name', () => {
    // same-case inputs to avoid locale-dependent case ordering
    const out = sortCategoryGroups(
      [g('Sports', 0, 5), g('Movies', 0, 0), g('News', 0, 2)],
      'alphabetical',
    );
    expect(out.map((x) => x.name)).toEqual(['Movies', 'News', 'Sports']);
  });

  it('provider mode, single source: orders by position', () => {
    const out = sortCategoryGroups(
      [g('Sports', 0, 5), g('Movies', 0, 0), g('UK', 0, 1)],
      'provider',
    );
    expect(out.map((x) => x.name)).toEqual(['Movies', 'UK', 'Sports']);
  });

  it('provider mode, multi-source: highest-priority source first, then position', () => {
    // Source priority 0 beats 1; within a source, position decides.
    const out = sortCategoryGroups(
      [g('B-from-src2', 1, 0), g('A-from-src1', 0, 9), g('C-from-src1', 0, 0)],
      'provider',
    );
    expect(out.map((x) => x.name)).toEqual(['C-from-src1', 'A-from-src1', 'B-from-src2']);
  });

  it('provider mode: defensive — unknown priority (999) sorts after known sources', () => {
    // 999 = source absent from liveSourceOrder (a dead branch in practice, since
    // categories are filtered to enabled sources, but the comparator must be safe).
    const out = sortCategoryGroups(
      [g('Unknown', 999, 0), g('Known', 0, 5)],
      'provider',
    );
    expect(out.map((x) => x.name)).toEqual(['Known', 'Unknown']);
  });

  it('provider mode: missing position (Infinity) sorts last, alpha among ties', () => {
    const out = sortCategoryGroups(
      [g('Zeta', 0, Number.POSITIVE_INFINITY), g('Alpha', 0, Number.POSITIVE_INFINITY), g('Real', 0, 0)],
      'provider',
    );
    expect(out.map((x) => x.name)).toEqual(['Real', 'Alpha', 'Zeta']);
  });

  it('does not mutate the input array', () => {
    const input = [g('B', 0, 1), g('A', 0, 0)];
    sortCategoryGroups(input, 'provider');
    expect(input.map((x) => x.name)).toEqual(['B', 'A']);
  });

  it('returns an empty array in both modes', () => {
    expect(sortCategoryGroups([], 'alphabetical')).toEqual([]);
    expect(sortCategoryGroups([], 'provider')).toEqual([]);
  });

  it('provider mode: same priority and finite position falls back to alpha', () => {
    const out = sortCategoryGroups(
      [g('Zebra', 0, 5), g('Apple', 0, 5), g('Mango', 0, 5)],
      'provider',
    );
    expect(out.map((x) => x.name)).toEqual(['Apple', 'Mango', 'Zebra']);
  });
});

describe('resolveGroupPrimary', () => {
  const order = new Map([['s1', 0], ['s2', 1]]);

  it('single source: returns that source priority + position', () => {
    const sources = [{ sourceId: 's2', position: 4 }];
    expect(resolveGroupPrimary(sources, order)).toEqual({ primaryPriority: 1, primaryPosition: 4 });
  });

  it('multi source: sorts sources by priority and reports the top one', () => {
    const sources = [
      { sourceId: 's2', position: 0 },
      { sourceId: 's1', position: 7 },
    ];
    const primary = resolveGroupPrimary(sources, order);
    // sources reordered in place: highest-priority (s1) first
    expect(sources.map((s) => s.sourceId)).toEqual(['s1', 's2']);
    expect(primary).toEqual({ primaryPriority: 0, primaryPosition: 7 });
  });

  it('unknown source (absent from order) gets priority 999', () => {
    const sources = [{ sourceId: 'ghost', position: 2 }];
    expect(resolveGroupPrimary(sources, order)).toEqual({ primaryPriority: 999, primaryPosition: 2 });
  });
});
