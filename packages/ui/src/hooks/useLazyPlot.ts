/**
 * useLazyPlot - Lazy-load plot/overview from TMDB on demand
 *
 * Fetches overview from TMDB API when:
 * - Item has tmdb_id (from export matching)
 * - Item is missing plot
 * - User has TMDB API key configured
 *
 * Caches result to DB so we don't refetch.
 */

import { useState, useEffect } from 'react';
import { db, type StoredMovie, type StoredSeries } from '../db';
import { getMovieDetails, getTvShowDetails } from '../services/tmdb';

type MediaItem = StoredMovie | StoredSeries;

/**
 * Check if item is a movie (has stream_id) vs series (has series_id)
 */
function isMovie(item: MediaItem): item is StoredMovie {
  return 'stream_id' in item && !('series_id' in item);
}

/**
 * Lazy-load plot for a movie or series from TMDB
 *
 * @param item - Movie or series to get plot for
 * @param apiKey - TMDB API key (if not provided, returns null)
 * @returns Plot text or null
 */
export function useLazyPlot(
  item: MediaItem | null | undefined,
  apiKey: string | null | undefined
): string | null {
  const [plot, setPlot] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!item) {
      setPlot(null);
      return;
    }

    // If we already have a plot, use it
    if (item.plot) {
      setPlot(item.plot);
      return;
    }

    // No API key or no tmdb_id - can't fetch
    if (!apiKey || !item.tmdb_id) {
      setPlot(null);
      return;
    }

    // Don't double-fetch
    if (fetching) return;

    // Fetch plot from TMDB
    const fetchPlot = async () => {
      setFetching(true);
      try {
        let overview: string | null = null;

        if (isMovie(item)) {
          const details = await getMovieDetails(apiKey, item.tmdb_id!);
          overview = details.overview || null;

          // Cache to DB
          if (overview) {
            await db.vodMovies.update(item.stream_id, {
              plot: overview,
            });
          }
        } else {
          const details = await getTvShowDetails(apiKey, item.tmdb_id!);
          overview = details.overview || null;

          // Cache to DB
          if (overview) {
            await db.vodSeries.update(item.series_id, {
              plot: overview,
            });
          }
        }

        if (overview) {
          setPlot(overview);
        }
      } catch (err) {
        console.warn('Failed to fetch TMDB plot:', err);
        // Silently fail - no plot to show
      } finally {
        setFetching(false);
      }
    };

    fetchPlot();
  }, [item?.tmdb_id, item?.plot, apiKey, fetching]);

  return plot;
}

export default useLazyPlot;
