import { useEffect, useState } from 'react';
import { getMovieDetails, getTmdbImageUrl, getTvShowDetails } from '../services/tmdb';
import { useTmdbApiKey } from '../stores/uiStore';

/** One lookup per title per session (cards scroll in and out). */
const cache = new Map<string, Promise<string | null>>();

/**
 * A title's TMDB poster, for titles this computer's library doesn't have (synced from another).
 * Only with this computer's TMDB key; null without one, or on any failure (no retries, no toast).
 */
export function useTmdbPoster(type: 'movie' | 'series', tmdbId: number): string | null {
  const key = useTmdbApiKey();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!key) { setUrl(null); return; }
    let live = true;
    const k = `${type}:${tmdbId}`;
    let p = cache.get(k);
    if (!p) {
      p = (type === 'movie' ? getMovieDetails(key, tmdbId) : getTvShowDetails(key, tmdbId))
        .then((d) => getTmdbImageUrl((d as { poster_path?: string | null }).poster_path))
        .catch(() => null);
      cache.set(k, p);
    }
    void p.then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [key, type, tmdbId]);
  return url;
}
