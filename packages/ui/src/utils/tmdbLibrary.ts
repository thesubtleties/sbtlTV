/**
 * Shared rules for rows built from TMDB ids matched against the user's library (Selected lists,
 * More like this): one copy per title, and a title with a copy in any adult category left out for
 * every copy (a clean copy elsewhere doesn't bring it back).
 */

/** The library's adult category ids; null until categories are known (callers then show nothing). */
export function adultCategoryIdsOf(groups: { name: string; categoryIds: string[] }[], ready: boolean, isAdult: (name: string) => boolean): Set<string> | null {
  return ready ? new Set(groups.filter((g) => isAdult(g.name)).flatMap((g) => g.categoryIds)) : null;
}

/** One copy per TMDB id (the first one given wins), adult titles left out. */
export function cleanByTmdbId<T extends { tmdb_id?: number; category_ids: string[] }>(items: T[], adultCategoryIds: Set<string>): Map<number, T> {
  const adult = new Set<number>();
  for (const it of items) {
    if (it.tmdb_id !== undefined && it.category_ids.some((c) => adultCategoryIds.has(c))) adult.add(it.tmdb_id);
  }
  const byId = new Map<number, T>();
  for (const it of items) {
    if (it.tmdb_id === undefined || adult.has(it.tmdb_id) || byId.has(it.tmdb_id)) continue;
    byId.set(it.tmdb_id, it);
  }
  return byId;
}
