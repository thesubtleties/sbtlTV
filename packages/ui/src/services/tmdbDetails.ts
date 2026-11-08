/**
 * One TMDB request per title for details and credits, shared by everything that
 * asks: the detail page's backdrop and plot hooks (which used to fetch details
 * twice), the hero, and the hover prefetch. Calls in flight share one promise; a
 * finished answer is kept for the session (small, bounded); a failure is dropped
 * so the next ask tries again.
 */
import {
  getMovieDetails,
  getTvShowDetails,
  getMovieCredits,
  getTvShowCredits,
  type TmdbMovieDetails,
  type TmdbTvDetails,
  type TmdbCredits,
} from './tmdb';

type Kind = 'movie' | 'series';
const MAX_ENTRIES = 400;
const entries = new Map<string, Promise<unknown>>();

function shared<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = entries.get(key);
  if (hit) {
    // Keep recently used titles: move to the end of the eviction order.
    entries.delete(key);
    entries.set(key, hit);
    return hit as Promise<T>;
  }
  const p = load();
  entries.set(key, p);
  p.catch(() => { if (entries.get(key) === p) entries.delete(key); });
  while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value as string);
  return p;
}

export function tmdbDetails(apiKey: string, kind: 'movie', tmdbId: number): Promise<TmdbMovieDetails>;
export function tmdbDetails(apiKey: string, kind: 'series', tmdbId: number): Promise<TmdbTvDetails>;
export function tmdbDetails(apiKey: string, kind: Kind, tmdbId: number): Promise<TmdbMovieDetails | TmdbTvDetails>;
export function tmdbDetails(apiKey: string, kind: Kind, tmdbId: number): Promise<TmdbMovieDetails | TmdbTvDetails> {
  return shared<TmdbMovieDetails | TmdbTvDetails>(`${kind}:${tmdbId}:details`, () => (kind === 'movie' ? getMovieDetails(apiKey, tmdbId) : getTvShowDetails(apiKey, tmdbId)));
}

export function tmdbCredits(apiKey: string, kind: Kind, tmdbId: number): Promise<TmdbCredits> {
  return shared(`${kind}:${tmdbId}:credits`, () => (kind === 'movie' ? getMovieCredits(apiKey, tmdbId) : getTvShowCredits(apiKey, tmdbId)));
}

/** Tests only. */
export function resetTmdbDetailsForTests(): void {
  entries.clear();
}
