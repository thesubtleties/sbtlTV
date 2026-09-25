/**
 * useLazyPlot - Lazy-load plot/overview and genre from TMDB on demand
 *
 * Fetches details from TMDB API when:
 * - Item has tmdb_id (from export matching)
 * - Item is missing plot or genre
 * - User has TMDB API key configured
 *
 * Caches result to DB so we don't refetch.
 */

import { useState, useEffect, useRef } from 'react';
import { data } from '../data/client';
import type { VodDetailFields } from '@sbtltv/core';
import { getMovieDetails, getTvShowDetails } from '../services/tmdb';
import { type MediaItem, isMovie } from '../types/media';

interface LazyDetails {
  plot: string | null;
  genre: string | null;
}

/**
 * Lazy-load plot and genre for a movie or series from TMDB
 *
 * @param item - Movie or series to get details for
 * @param apiKey - TMDB API key (if not provided, returns nulls)
 * @returns Object with plot and genre strings
 */
export function useLazyPlot(
  item: MediaItem | null | undefined,
  apiKey: string | null | undefined
): LazyDetails {
  // Check what we already have
  const existingPlot = item?.plot || null;
  const existingGenre = item?.genre || null;

  const [fetchedDetails, setFetchedDetails] = useState<LazyDetails>({
    plot: null,
    genre: null,
  });
  const lastItemIdRef = useRef<string | null>(null);
  const fetchingRef = useRef(false);

  // Get item ID for tracking
  const itemId = item ? (isMovie(item) ? item.stream_id : item.series_id) : null;

  // Reset fetched details when item changes
  if (itemId !== lastItemIdRef.current) {
    lastItemIdRef.current = itemId;
    if (fetchedDetails.plot !== null || fetchedDetails.genre !== null) {
      setFetchedDetails({ plot: null, genre: null });
    }
  }

  useEffect(() => {
    if (!item) {
      return;
    }

    // If we already have both plot and genre, no need to fetch
    if (existingPlot && existingGenre) {
      return;
    }

    // No API key or no tmdb_id - can't fetch
    if (!apiKey || !item.tmdb_id) {
      return;
    }

    // Don't double-fetch
    if (fetchingRef.current) return;

    let cancelled = false;

    const fetchDetails = async () => {
      fetchingRef.current = true;
      try {
        let overview: string | null = null;
        let genreStr: string | null = null;

        if (isMovie(item)) {
          const details = await getMovieDetails(apiKey, item.tmdb_id!);
          if (cancelled) return;

          overview = details.overview || null;
          // Get all genre names, comma-separated
          if (details.genres && details.genres.length > 0) {
            genreStr = details.genres.map((g) => g.name).join(', ');
          }

          // Cache to the data process - it only fills fields that are empty
          const updates: VodDetailFields = {};
          if (overview && !existingPlot) updates.plot = overview;
          if (genreStr && !existingGenre) updates.genre = genreStr;

          if (Object.keys(updates).length > 0) {
            await data.query({ type: 'updateVodDetails', kind: 'movie', itemId: item.stream_id, fields: updates });
          }
        } else {
          const details = await getTvShowDetails(apiKey, item.tmdb_id!);
          if (cancelled) return;

          overview = details.overview || null;
          // Get all genre names, comma-separated
          if (details.genres && details.genres.length > 0) {
            genreStr = details.genres.map((g) => g.name).join(', ');
          }

          // Cache to the data process
          const updates: VodDetailFields = {};
          if (overview && !existingPlot) updates.plot = overview;
          if (genreStr && !existingGenre) updates.genre = genreStr;

          if (Object.keys(updates).length > 0) {
            await data.query({ type: 'updateVodDetails', kind: 'series', itemId: item.series_id, fields: updates });
          }
        }

        if (!cancelled) {
          setFetchedDetails({
            plot: overview,
            genre: genreStr,
          });
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('Failed to fetch TMDB details:', err);
        }
      } finally {
        fetchingRef.current = false;
      }
    };

    fetchDetails();

    return () => {
      cancelled = true;
      fetchingRef.current = false;
    };
  }, [item?.tmdb_id, existingPlot, existingGenre, apiKey]);

  // Return existing data or fetched data
  return {
    plot: existingPlot || fetchedDetails.plot,
    genre: existingGenre || fetchedDetails.genre,
  };
}

export default useLazyPlot;
