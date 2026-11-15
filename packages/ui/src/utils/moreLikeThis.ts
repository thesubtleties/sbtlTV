/**
 * "More like this" on a detail page: TMDB's recommendations for the title, then its similar titles,
 * kept to what the user's own library has. Same rules as the Selected lists rows: one copy per title
 * (the preferred source's, as the caller passes them in), a title in any adult category left out,
 * TMDB's order kept, the title itself never listed. Fewer than `min` = no row.
 */
export const MORE_LIKE_THIS_MIN = 4;
export const MORE_LIKE_THIS_MAX = 20;
/** Ask TMDB for similar titles too when recommendations alone match fewer than this. */
export const MORE_LIKE_THIS_ENOUGH = 6;

export function pickMoreLikeThis<T extends { tmdb_id?: number; category_ids: string[] }>(
  orderedIds: number[],
  library: T[],
  adultCategoryIds: Set<string> | null,
  selfTmdbId: number | undefined,
  { min = MORE_LIKE_THIS_MIN, max = MORE_LIKE_THIS_MAX } = {},
): T[] {
  if (!adultCategoryIds) return []; // categories not known yet: no row rather than one that skips the adult check
  const adult = new Set<number>();
  for (const it of library) {
    if (it.tmdb_id !== undefined && it.category_ids.some((c) => adultCategoryIds.has(c))) adult.add(it.tmdb_id);
  }
  const byId = new Map<number, T>();
  for (const it of library) {
    if (it.tmdb_id === undefined || adult.has(it.tmdb_id) || byId.has(it.tmdb_id)) continue;
    byId.set(it.tmdb_id, it);
  }
  const seen = new Set<number>();
  const picked: T[] = [];
  for (const id of orderedIds) {
    if (id === selfTmdbId || seen.has(id)) continue;
    seen.add(id);
    const it = byId.get(id);
    if (it) picked.push(it);
    if (picked.length >= max) break;
  }
  return picked.length >= min ? picked : [];
}

/** How many of these ids the library has (to decide whether to ask for similar titles too). */
export function countInLibrary(ids: number[], library: { tmdb_id?: number }[], selfTmdbId: number | undefined): number {
  const have = new Set(library.map((it) => it.tmdb_id));
  return new Set(ids.filter((id) => id !== selfTmdbId && have.has(id))).size;
}
