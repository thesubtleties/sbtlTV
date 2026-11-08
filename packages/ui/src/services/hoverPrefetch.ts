/**
 * Hover-intent prefetch for VOD cards: resting on a card (or focusing it) warms
 * what its detail page will ask for, so the page opens filled in.
 *
 * - after DETAILS_DWELL_MS: TMDB details and credits the stored row lacks (only
 *   with a TMDB key; shared with the detail hooks, so nothing is fetched twice),
 *   then the backdrop image is preloaded.
 * - after EPISODES_DWELL_MS, series only: the episode list from the provider. The
 *   data process skips it when the stored list is under a day old, so a fresh
 *   series costs no provider request; a failed attempt is not retried for a while.
 *
 * Leaving the card before a timer fires cancels it. One card at a time.
 */

export const DETAILS_DWELL_MS = 200;
export const EPISODES_DWELL_MS = 300;
export const EPISODES_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const EPISODES_RETRY_AFTER_MS = 10 * 60 * 1000;

export interface PrefetchTarget {
  kind: 'movie' | 'series';
  tmdbId: number | null;
  seriesId: string | null;        // series only
  apiKey: string | null;          // TMDB key; null = no TMDB requests
  needsDetails: boolean;          // backdrop, plot or genre missing from the stored row
  needsCredits: boolean;          // cast (or a movie's director) missing
  // The URL the detail page will show, given the backdrop path TMDB returned (if asked).
  backdropUrl: (fetchedPath: string | null) => string | null;
}

export interface PrefetchDeps {
  details(apiKey: string, kind: 'movie' | 'series', tmdbId: number): Promise<{ backdrop_path?: string | null }>;
  credits(apiKey: string, kind: 'movie' | 'series', tmdbId: number): Promise<unknown>;
  episodes(seriesId: string): Promise<unknown>;
  preload(url: string): void;
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface HoverPrefetch {
  /** Start dwelling on a card. Returns a token for leave(). */
  enter(target: PrefetchTarget): number;
  /** Stop dwelling; with a token, only if that card is still the current one. */
  leave(token?: number): void;
}

const MAX_REMEMBERED = 500;

function remember<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > MAX_REMEMBERED) map.delete(map.keys().next().value as K);
}

export function createHoverPrefetch(deps: PrefetchDeps): HoverPrefetch {
  let current = 0;
  let timers: unknown[] = [];
  const preloaded = new Map<string, true>();
  const episodesAskedAt = new Map<string, number>();

  const preload = (url: string | null) => {
    if (!url || preloaded.has(url)) return;
    remember(preloaded, url, true);
    deps.preload(url);
  };

  const warmDetails = (t: PrefetchTarget) => {
    if (t.apiKey && t.tmdbId != null) {
      const { apiKey, kind, tmdbId } = t;
      if (t.needsDetails) {
        deps.details(apiKey, kind, tmdbId).then((d) => preload(t.backdropUrl(d.backdrop_path ?? null)), () => preload(t.backdropUrl(null)));
      } else {
        preload(t.backdropUrl(null));
      }
      if (t.needsCredits) deps.credits(apiKey, kind, tmdbId).catch(() => {});
    } else {
      preload(t.backdropUrl(null));
    }
  };

  const warmEpisodes = (seriesId: string) => {
    const asked = episodesAskedAt.get(seriesId);
    if (asked !== undefined && deps.now() - asked < EPISODES_RETRY_AFTER_MS) return;
    remember(episodesAskedAt, seriesId, deps.now());
    deps.episodes(seriesId).catch(() => {});
  };

  const cancel = () => {
    for (const h of timers) deps.clearTimeout(h);
    timers = [];
  };

  return {
    enter(t) {
      cancel();
      const token = ++current;
      timers.push(deps.setTimeout(() => warmDetails(t), DETAILS_DWELL_MS));
      if (t.kind === 'series' && t.seriesId) {
        const seriesId = t.seriesId;
        timers.push(deps.setTimeout(() => warmEpisodes(seriesId), EPISODES_DWELL_MS));
      }
      return token;
    },
    leave(token) {
      if (token !== undefined && token !== current) return;
      cancel();
    },
  };
}
