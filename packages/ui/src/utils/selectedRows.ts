import type { SelectedList } from '../types/electron';
import { cleanByTmdbId } from './tmdbLibrary';

export interface SelectedRow<T> { key: string; title: string; blurb: string; items: T[] }

/**
 * One home row per Selected list: only the user's own titles, in the list's order, one copy per
 * title. A title in any adult category is dropped for every copy (a clean copy elsewhere doesn't
 * bring it back). Rows with fewer than `min` titles are left out. `adultCategoryIds` null =
 * categories not loaded: nothing is shown.
 */
export function buildSelectedRows<T extends { tmdb_id?: number; category_ids: string[] }>(
  lists: SelectedList[], items: T[], adultCategoryIds: Set<string> | null, min = 6,
): SelectedRow<T>[] {
  // Categories not known yet (or failed to load): no rows, rather than rows that skip the adult check
  if (!adultCategoryIds) return [];
  const byId = cleanByTmdbId(items, adultCategoryIds);
  const rows: SelectedRow<T>[] = [];
  for (const list of lists) {
    const picked = list.items.map((id) => byId.get(id)).filter((x): x is T => x !== undefined);
    if (picked.length >= min) rows.push({ key: `selected-${list.id}`, title: list.name, blurb: list.blurb, items: picked });
  }
  return rows;
}
