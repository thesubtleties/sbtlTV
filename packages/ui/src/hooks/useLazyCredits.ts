/**
 * useLazyCredits - Lazy-load cast and director from TMDB
 *
 * Fetches credits from TMDB API when:
 * - Item has tmdb_id (from export matching)
 * - Item is missing cast or director
 * - User has TMDB API key configured
 *
 * Caches result to DB so we don't refetch.
 */

import { useState, useEffect, useRef } from 'react';
import { db, type StoredMovie } from '../db';
import { getMovieCredits, getTvShowCredits } from '../services/tmdb';
import { type MediaItem, isMovie } from '../types/media';

interface Credits {
  cast: string | null;
  director: string | null;
}

/**
 * Lazy-load credits (cast and director) for a movie or series
 *
 * @param item - Movie or series to get credits for
 * @param apiKey - TMDB API key (if not provided, returns null)
 * @returns Credits object with cast and director strings
 */
export function useLazyCredits(
  item: MediaItem | null | undefined,
  apiKey: string | null | undefined
): Credits {
  // Return existing credits if already have them
  const hasCast = item?.cast && item.cast.trim().length > 0;
  const hasDirector = item && isMovie(item) && !!item.director?.trim();

  const [fetchedCredits, setFetchedCredits] = useState<Credits>({
    cast: null,
    director: null,
  });
  const lastItemIdRef = useRef<string | null>(null);
  const fetchingRef = useRef(false);

  // Get item ID for tracking
  const itemId = item ? (isMovie(item) ? item.stream_id : item.series_id) : null;

  // Reset fetched credits when item changes
  if (itemId !== lastItemIdRef.current) {
    lastItemIdRef.current = itemId;
    if (fetchedCredits.cast !== null || fetchedCredits.director !== null) {
      setFetchedCredits({ cast: null, director: null });
    }
  }

  useEffect(() => {
    if (!item) return;

    // If we already have both cast and director (for movies), no need to fetch
    if (hasCast && (hasDirector || !isMovie(item))) {
      return;
    }

    // No API key or no tmdb_id - can't fetch
    if (!apiKey || !item.tmdb_id) {
      return;
    }

    // Don't double-fetch
    if (fetchingRef.current) return;

    let cancelled = false;

    const fetchCredits = async () => {
      fetchingRef.current = true;
      try {
        let castString: string | null = null;
        let directorString: string | null = null;

        if (isMovie(item)) {
          const credits = await getMovieCredits(apiKey, item.tmdb_id!);
          if (cancelled) return;

          // Get top 5 cast members
          const topCast = credits.cast
            .slice(0, 5)
            .map((c) => c.name)
            .join(', ');
          if (topCast) castString = topCast;

          // Get director(s) from crew
          const directors = credits.crew
            .filter((c) => c.job === 'Director')
            .map((c) => c.name)
            .join(', ');
          if (directors) directorString = directors;

          // Cache to DB
          const updates: Partial<StoredMovie> = {};
          if (castString && !hasCast) updates.cast = castString;
          if (directorString && !hasDirector) updates.director = directorString;

          if (Object.keys(updates).length > 0) {
            await db.vodMovies.update(item.stream_id, updates);
          }
        } else {
          const credits = await getTvShowCredits(apiKey, item.tmdb_id!);
          if (cancelled) return;

          // Get top 5 cast members
          const topCast = credits.cast
            .slice(0, 5)
            .map((c) => c.name)
            .join(', ');
          if (topCast) castString = topCast;

          // Cache to DB
          if (castString && !hasCast) {
            await db.vodSeries.update(item.series_id, { cast: castString });
          }
        }

        if (!cancelled) {
          setFetchedCredits({
            cast: castString,
            director: directorString,
          });
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('Failed to fetch TMDB credits:', err);
        }
      } finally {
        fetchingRef.current = false;
      }
    };

    fetchCredits();

    return () => {
      cancelled = true;
      fetchingRef.current = false;
    };
  }, [item?.tmdb_id, item?.cast, apiKey, hasCast, hasDirector]);

  // Return existing credits or fetched credits
  return {
    cast: (hasCast ? item?.cast : fetchedCredits.cast) ?? null,
    director: (hasDirector && item && isMovie(item) ? item.director : fetchedCredits.director) ?? null,
  };
}

export default useLazyCredits;
