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
import { db } from '../db';
import {
  getMovieDetails,
  getTvShowDetails,
  getTmdbImageUrl,
  TMDB_BACKDROP_SIZES,
} from '../services/tmdb';
import { getRpdbBackdropUrl } from '../services/rpdb';
import { useRpdbSettings } from './useRpdbSettings';
import { type MediaItem, isMovie } from '../types/media';

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
  // Load RPDB settings
  const { apiKey: rpdbApiKey, backdropsEnabled: rpdbBackdropsEnabled } = useRpdbSettings();

  // State only for async-fetched backdrops (must be called before any early returns)
  const [fetchedUrl, setFetchedUrl] = useState<string | null>(null);
  const lastItemIdRef = useRef<string | null>(null);
  // useRef instead of useState - synchronously mutable, no stale closure issues
  const fetchingRef = useRef(false);

  // Get item ID for tracking
  const itemId = item ? (isMovie(item) ? item.stream_id : item.series_id) : null;

  // Check if we should use RPDB backdrop
  const itemType = item ? (isMovie(item) ? 'movie' : 'series') : null;
  const rpdbBackdropUrl = rpdbApiKey && rpdbBackdropsEnabled && item?.tmdb_id && itemType
    ? getRpdbBackdropUrl(rpdbApiKey, item.tmdb_id, itemType)
    : null;

  // Synchronously compute URL if item already has backdrop_path (no flash)
  const cachedUrl = item?.backdrop_path
    ? getTmdbImageUrl(item.backdrop_path, TMDB_BACKDROP_SIZES[size])
    : null;

  // Reset fetched URL when item changes
  if (itemId !== lastItemIdRef.current) {
    lastItemIdRef.current = itemId;
    if (fetchedUrl !== null) {
      setFetchedUrl(null);
    }
  }

  useEffect(() => {
    if (!item) {
      return;
    }

    // If we already have a backdrop_path, no need to fetch
    if (item.backdrop_path) {
      return;
    }

    // No API key or no tmdb_id - can't fetch
    if (!apiKey || !item.tmdb_id) {
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
          setFetchedUrl(getTmdbImageUrl(backdropPath, TMDB_BACKDROP_SIZES[size]));
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

  // Priority: RPDB backdrop > cached TMDB URL > fetched TMDB URL
  return rpdbBackdropUrl || cachedUrl || fetchedUrl;
}

export default useLazyBackdrop;
