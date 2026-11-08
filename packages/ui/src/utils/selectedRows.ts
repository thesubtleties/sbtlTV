import type { SelectedList } from '../types/electron';

export interface SelectedRow<T> { key: string; title: string; blurb: string; items: T[] }

/**
 * One home row per Selected list: only the user's own titles, in the list's order, one copy per
 * title. A title in any adult category is dropped for every copy (a clean copy elsewhere doesn't
 * bring it back). Rows with fewer than `min` titles are left out.
 */
export function buildSelectedRows<T extends { tmdb_id?: number; category_ids: string[] }>(
  lists: SelectedList[], items: T[], adultCategoryIds: Set<string>, min = 6,
): SelectedRow<T>[] {
  const adult = new Set<number>();
  for (const it of items) {
    if (it.tmdb_id !== undefined && it.category_ids.some((c) => adultCategoryIds.has(c))) adult.add(it.tmdb_id);
  }
  const byId = new Map<number, T>();
  for (const it of items) {
    if (it.tmdb_id === undefined || adult.has(it.tmdb_id) || byId.has(it.tmdb_id)) continue;
    byId.set(it.tmdb_id, it);
  }
  const rows: SelectedRow<T>[] = [];
  for (const list of lists) {
    const picked = list.items.map((id) => byId.get(id)).filter((x): x is T => x !== undefined);
    if (picked.length >= min) rows.push({ key: `selected-${list.id}`, title: list.name, blurb: list.blurb, items: picked });
  }
  return rows;
}
