import { describe, expect, test } from 'vitest';
import { buildSelectedRows } from './selectedRows';

const m = (tmdb_id: number, cats: string[] = ['c1']) => ({ tmdb_id, category_ids: cats, name: `m${tmdb_id}` });
const L = (o: Record<string, unknown> = {}) => ({ id: 'noir', name: 'Noir nights', blurb: 'Rain.', items: [5, 4, 3, 2, 1, 6, 7], ...o });
const ids = (rows: ReturnType<typeof buildSelectedRows>) => rows[0]!.items.map((i) => i.tmdb_id);

describe('buildSelectedRows', () => {
  test('keeps the list order and one copy per title', () => {
    const rows = buildSelectedRows([L()], [m(1), m(2), m(3), m(4), m(5), m(6), m(7), m(5)], new Set());
    expect(ids(rows)).toEqual([5, 4, 3, 2, 1, 6, 7]);
    expect(rows[0]).toMatchObject({ key: 'selected-noir', title: 'Noir nights', blurb: 'Rain.' });
  });
  test('hides a row with fewer than 6 matches', () => {
    expect(buildSelectedRows([L()], [m(1), m(2), m(3), m(4), m(5)], new Set())).toEqual([]);
  });
  test('drops a title found in any adult category, even when another copy is clean', () => {
    const items = [m(1), m(2), m(3), m(4), m(5), m(6), m(7, ['c1', 'xx']), m(7, ['c1'])];
    expect(ids(buildSelectedRows([L()], items, new Set(['xx'])))).not.toContain(7);
  });
  test('titles the provider has no TMDB id for are ignored', () => {
    const items = [1, 2, 3, 4, 5, 6].map((n) => m(n)).concat([{ category_ids: ['c1'], name: 'x' } as never]);
    expect(ids(buildSelectedRows([L()], items, new Set()))).toEqual([5, 4, 3, 2, 1, 6]);
  });
  test('name and blurb pass through as plain strings', () => {
    const rows = buildSelectedRows([L({ name: '<script>x</script>' })], [1, 2, 3, 4, 5, 6].map((n) => m(n)), new Set());
    expect(rows[0]!.title).toBe('<script>x</script>');
  });
  test('no rows until the categories are known (else adult titles could slip through)', () => {
    expect(buildSelectedRows([L()], [1, 2, 3, 4, 5, 6, 7].map((n) => m(n)), null)).toEqual([]);
  });
  test('several lists, each its own row, in list order', () => {
    const items = Array.from({ length: 12 }, (_, i) => m(i + 1));
    const rows = buildSelectedRows([L({ id: 'a', items: [1, 2, 3, 4, 5, 6] }), L({ id: 'b', items: [7, 8, 9, 10, 11, 12] })], items, new Set());
    expect(rows.map((r) => r.key)).toEqual(['selected-a', 'selected-b']);
  });
});
