/**
 * "More like this" on a detail page: TMDB's recommendations for the title, then its similar titles,
 * kept to what the user's own library has. Same rules as the Selected lists rows (utils/tmdbLibrary):
 * one copy per title, a title with any copy in an adult category left out. `library` is every copy,
 * the preferred one first (that one is shown). TMDB's order kept, the title itself never listed.
 * Fewer than `min` = no row.
 */
import { cleanByTmdbId } from './tmdbLibrary';

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
  const byId = cleanByTmdbId(library, adultCategoryIds);
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

/**
 * Whether the library answer is the one for the ids on hand: no ids = nothing to look up (ready, empty);
 * otherwise a reply has arrived and it is not still the reply for the previous ids.
 */
export function relatedLibraryReady(idCount: number, reply: unknown, stale: boolean): boolean {
  if (idCount === 0) return true;
  return reply !== undefined && !stale;
}

/**
 * Whether to also ask TMDB for similar titles. Only once the recommendations for this title are in
 * (and didn't fail), the library answer is for those ids, and the categories are known; then only
 * when the row would have fewer than `enough` titles by the row's own rules.
 */
export function shouldAskSimilar<T extends { tmdb_id?: number; category_ids: string[] }>(p: {
  recs: { ids: number[]; failed: boolean } | null;
  similarAsked: boolean;
  library: T[] | null; // null = not loaded for these ids yet
  adultCategoryIds: Set<string> | null;
  selfTmdbId: number | undefined;
  enough?: number;
}): boolean {
  const { recs, similarAsked, library, adultCategoryIds, selfTmdbId, enough = MORE_LIKE_THIS_ENOUGH } = p;
  if (!recs || recs.failed || similarAsked || !library || !adultCategoryIds) return false;
  return pickMoreLikeThis(recs.ids, library, adultCategoryIds, selfTmdbId, { min: 0, max: enough }).length < enough;
}
