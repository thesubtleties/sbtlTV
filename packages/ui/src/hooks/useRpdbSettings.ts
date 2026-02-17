/**
 * useRpdbSettings - Hook for accessing RPDB (RatingPosterDB) settings
 *
 * Reads from Zustand store (hydrated at startup) instead of IPC.
 * Provides helper functions for generating RPDB image URLs.
 */

import {
  usePosterDbApiKey,
  useRpdbBackdropsEnabled,
  useSettingsLoaded,
} from '../stores/uiStore';
import {
  getRpdbPosterUrl,
  getRpdbBackdropUrl,
  rpdbSupportsBackdrops,
} from '../services/rpdb';

interface RpdbSettings {
  apiKey: string | null;
  backdropsEnabled: boolean;
  loading: boolean;
}

/**
 * Load RPDB settings from Zustand store
 */
export function useRpdbSettings(): RpdbSettings {
  const apiKey = usePosterDbApiKey();
  const backdropsEnabled = useRpdbBackdropsEnabled();
  const loaded = useSettingsLoaded();
  return { apiKey, backdropsEnabled, loading: !loaded };
}

/**
 * Get RPDB poster URL if available, otherwise return null
 *
 * @param rpdbApiKey - RPDB API key (from useRpdbSettings)
 * @param tmdbId - TMDB ID of the movie or series
 * @param type - 'movie' or 'series'
 * @returns RPDB poster URL or null
 */
export function useRpdbPosterUrl(
  rpdbApiKey: string | null,
  tmdbId: number | null | undefined,
  type: 'movie' | 'series'
): string | null {
  if (!rpdbApiKey || !tmdbId) {
    return null;
  }
  return getRpdbPosterUrl(rpdbApiKey, tmdbId, type);
}

/**
 * Get RPDB backdrop URL if available and enabled, otherwise return null
 *
 * @param rpdbApiKey - RPDB API key (from useRpdbSettings)
 * @param tmdbId - TMDB ID of the movie or series
 * @param type - 'movie' or 'series'
 * @param backdropsEnabled - Whether user has enabled RPDB backdrops
 * @returns RPDB backdrop URL or null
 */
export function useRpdbBackdropUrl(
  rpdbApiKey: string | null,
  tmdbId: number | null | undefined,
  type: 'movie' | 'series',
  backdropsEnabled: boolean
): string | null {
  if (!rpdbApiKey || !tmdbId || !backdropsEnabled) {
    return null;
  }

  // Check if tier supports backdrops
  if (!rpdbSupportsBackdrops(rpdbApiKey)) {
    return null;
  }

  return getRpdbBackdropUrl(rpdbApiKey, tmdbId, type);
}

export default useRpdbSettings;
