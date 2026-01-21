/**
 * useLazyBackdrop - Lazy-load TMDB backdrop images on demand
 *
 * Fetches backdrop from TMDB API when:
 * - Item has tmdb_id (from export matching)
 * - Item is missing backdrop_path
 * - User has TMDB API key configured
 *
 * Caches result to DB so we don't refetch.
 */

import { useState, useEffect, useRef } from 'react';
import { db, type StoredMovie, type StoredSeries } from '../db';
import {
  getMovieDetails,
  getTvShowDetails,
  getTmdbImageUrl,
  TMDB_BACKDROP_SIZES,
} from '../services/tmdb';

type MediaItem = StoredMovie | StoredSeries;

/**
 * Check if item is a movie (has stream_id) vs series (has series_id)
 */
function isMovie(item: MediaItem): item is StoredMovie {
  return 'stream_id' in item && !('series_id' in item);
}

/**
 * Lazy-load backdrop for a movie or series
 *
 * @param item - Movie or series to get backdrop for
 * @param apiKey - TMDB API key (if not provided, returns null)
 * @param size - Backdrop size (default: large)
 * @returns Backdrop URL or null
 */
export function useLazyBackdrop(
  item: MediaItem | null | undefined,
  apiKey: string | null | undefined,
  size: keyof typeof TMDB_BACKDROP_SIZES = 'large'
): string | null {
  const [backdropUrl, setBackdropUrl] = useState<string | null>(null);
  // useRef instead of useState - synchronously mutable, no stale closure issues
  const fetchingRef = useRef(false);

  useEffect(() => {
    if (!item) {
      setBackdropUrl(null);
      return;
    }

    // If we already have a backdrop_path, use it
    if (item.backdrop_path) {
      setBackdropUrl(getTmdbImageUrl(item.backdrop_path, TMDB_BACKDROP_SIZES[size]));
      return;
    }

    // No API key or no tmdb_id - can't fetch
    if (!apiKey || !item.tmdb_id) {
      setBackdropUrl(null);
      return;
    }

    // Don't double-fetch - ref is synchronously checked, no race condition
    if (fetchingRef.current) return;

    // Track if this effect instance is still active (for cleanup)
    let cancelled = false;

    // Fetch backdrop from TMDB
    const fetchBackdrop = async () => {
      fetchingRef.current = true;
      try {
        let backdropPath: string | null = null;

        if (isMovie(item)) {
          const details = await getMovieDetails(apiKey, item.tmdb_id!);
          if (cancelled) return;
          backdropPath = details.backdrop_path;

          // Cache to DB
          if (backdropPath) {
            await db.vodMovies.update(item.stream_id, {
              backdrop_path: backdropPath,
            });
          }
        } else {
          const details = await getTvShowDetails(apiKey, item.tmdb_id!);
          if (cancelled) return;
          backdropPath = details.backdrop_path;

          // Cache to DB
          if (backdropPath) {
            await db.vodSeries.update(item.series_id, {
              backdrop_path: backdropPath,
            });
          }
        }

        if (!cancelled && backdropPath) {
          setBackdropUrl(getTmdbImageUrl(backdropPath, TMDB_BACKDROP_SIZES[size]));
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('Failed to fetch TMDB backdrop:', err);
        }
        // Silently fail - fallback to cover image
      } finally {
        fetchingRef.current = false;
      }
    };

    fetchBackdrop();

    // Cleanup: mark as cancelled and reset fetching flag so next effect can fetch
    return () => {
      cancelled = true;
      fetchingRef.current = false;
    };
  }, [item?.tmdb_id, item?.backdrop_path, apiKey, size]);

  return backdropUrl;
}

export default useLazyBackdrop;
