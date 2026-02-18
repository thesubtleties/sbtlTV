/**
 * UI State Store - Zustand store for transient UI state
 *
 * Stores UI state that should persist during the session but reset on app restart.
 * Designed to be easily extended with backend persistence middleware later.
 */

import { create } from 'zustand';

import type { AppSettings, UpdateInfo } from '../types/electron';
import type { MediaItem } from '../types/media';

// Auto-updater state machine
export type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'ready' | 'up-to-date' | 'error';
export type UpdateState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'downloading'; percent: number; version: string }
  | { phase: 'ready'; version: string }
  | { phase: 'up-to-date' }
  | { phase: 'error'; message: string };

interface UIState {
  // Movies page
  moviesSelectedCategory: string | null;  // null = home, 'all' = all, string = category id
  setMoviesSelectedCategory: (id: string | null) => void;

  // Series page
  seriesSelectedCategory: string | null;
  setSeriesSelectedCategory: (id: string | null) => void;

  // Search queries (persist per media type)
  moviesSearchQuery: string;
  seriesSearchQuery: string;
  setMoviesSearchQuery: (query: string) => void;
  setSeriesSearchQuery: (query: string) => void;

  // Scroll positions (home view)
  moviesHomeScrollPosition: number;
  seriesHomeScrollPosition: number;
  setMoviesHomeScrollPosition: (pos: number) => void;
  setSeriesHomeScrollPosition: (pos: number) => void;

  // Detail view state (persists selected item)
  moviesDetailItem: MediaItem | null;
  seriesDetailItem: MediaItem | null;
  setMoviesDetailItem: (item: MediaItem | null) => void;
  setSeriesDetailItem: (item: MediaItem | null) => void;

  // Page collapsed state (slides whole page down, preserves detail)
  moviesPageCollapsed: boolean;
  seriesPageCollapsed: boolean;
  setMoviesPageCollapsed: (collapsed: boolean) => void;
  setSeriesPageCollapsed: (collapsed: boolean) => void;

  // Sync state - persists across Settings open/close
  channelSyncing: boolean;
  vodSyncing: boolean;
  tmdbMatching: boolean;
  cacheClearing: boolean;
  setChannelSyncing: (value: boolean) => void;
  setVodSyncing: (value: boolean) => void;
  setTmdbMatching: (value: boolean) => void;
  setCacheClearing: (value: boolean) => void;

  // Auto-updater state (centralized so listeners register once)
  updaterState: UpdateState;
  updaterDismissed: boolean;
  setUpdaterState: (state: UpdateState) => void;
  setUpdaterDownloadProgress: (percent: number) => void;
  dismissUpdater: () => void;

  // App settings (hydrated from electron-store on startup)
  settings: AppSettings;
  settingsLoaded: boolean;
  hydrateSettings: (data: AppSettings) => void;
  updateSettings: (partial: Partial<AppSettings>) => void;
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  channelSortOrder: 'alphabetical',
  categoryBarWidth: 160,
  guideOpacity: 0.95,
  vodRefreshHours: 24,
  epgRefreshHours: 6,
  autoUpdateEnabled: true,
};

export const useUIStore = create<UIState>((set) => ({
  // Movies
  moviesSelectedCategory: null,
  setMoviesSelectedCategory: (id) => set({ moviesSelectedCategory: id }),

  // Series
  seriesSelectedCategory: null,
  setSeriesSelectedCategory: (id) => set({ seriesSelectedCategory: id }),

  // Search queries
  moviesSearchQuery: '',
  seriesSearchQuery: '',
  setMoviesSearchQuery: (query) => set({ moviesSearchQuery: query }),
  setSeriesSearchQuery: (query) => set({ seriesSearchQuery: query }),

  // Scroll positions (home)
  moviesHomeScrollPosition: 0,
  seriesHomeScrollPosition: 0,
  setMoviesHomeScrollPosition: (pos) => set({ moviesHomeScrollPosition: pos }),
  setSeriesHomeScrollPosition: (pos) => set({ seriesHomeScrollPosition: pos }),

  // Detail view state
  moviesDetailItem: null,
  seriesDetailItem: null,
  setMoviesDetailItem: (item) => set({ moviesDetailItem: item }),
  setSeriesDetailItem: (item) => set({ seriesDetailItem: item }),

  // Page collapsed state
  moviesPageCollapsed: false,
  seriesPageCollapsed: false,
  setMoviesPageCollapsed: (collapsed) => set({ moviesPageCollapsed: collapsed }),
  setSeriesPageCollapsed: (collapsed) => set({ seriesPageCollapsed: collapsed }),

  // Auto-updater
  updaterState: { phase: 'idle' } as UpdateState,
  updaterDismissed: false,
  setUpdaterState: (state) => set({ updaterState: state, updaterDismissed: false }),
  setUpdaterDownloadProgress: (percent) => set((s) =>
    s.updaterState.phase === 'downloading'
      ? { updaterState: { ...s.updaterState, percent } }
      : {},
  ),
  dismissUpdater: () => set({ updaterDismissed: true }),

  // Sync state
  channelSyncing: false,
  vodSyncing: false,
  tmdbMatching: false,
  cacheClearing: false,
  setChannelSyncing: (value) => set({ channelSyncing: value }),
  setVodSyncing: (value) => set({ vodSyncing: value }),
  setTmdbMatching: (value) => set({ tmdbMatching: value }),
  setCacheClearing: (value) => set({ cacheClearing: value }),

  // App settings
  settings: DEFAULT_SETTINGS,
  settingsLoaded: false,
  hydrateSettings: (data) => set({ settings: { ...DEFAULT_SETTINGS, ...data }, settingsLoaded: true }),
  updateSettings: (partial) => set((state) => {
    const merged = { ...state.settings, ...partial };
    // Clamp categoryBarWidth (120-400) and guideOpacity (0.5-1.0)
    if (partial.categoryBarWidth !== undefined) {
      merged.categoryBarWidth = Math.max(120, Math.min(400, merged.categoryBarWidth ?? 160));
    }
    if (partial.guideOpacity !== undefined) {
      const val = merged.guideOpacity ?? 0.95;
      merged.guideOpacity = Number.isNaN(val) ? 0.95 : Math.max(0.5, Math.min(1.0, val));
    }
    return { settings: merged };
  }),
}));

// Selectors for cleaner component code
export const useMoviesCategory = () => useUIStore((s) => s.moviesSelectedCategory);
export const useSetMoviesCategory = () => useUIStore((s) => s.setMoviesSelectedCategory);

export const useSeriesCategory = () => useUIStore((s) => s.seriesSelectedCategory);
export const useSetSeriesCategory = () => useUIStore((s) => s.setSeriesSelectedCategory);

// Sync state selectors
export const useChannelSyncing = () => useUIStore((s) => s.channelSyncing);
export const useSetChannelSyncing = () => useUIStore((s) => s.setChannelSyncing);
export const useVodSyncing = () => useUIStore((s) => s.vodSyncing);
export const useSetVodSyncing = () => useUIStore((s) => s.setVodSyncing);
export const useTmdbMatching = () => useUIStore((s) => s.tmdbMatching);
export const useSetTmdbMatching = () => useUIStore((s) => s.setTmdbMatching);
export const useCacheClearing = () => useUIStore((s) => s.cacheClearing);
export const useSetCacheClearing = () => useUIStore((s) => s.setCacheClearing);

// Settings selectors (read from settings object, with defaults)
export const useChannelSortOrder = () => useUIStore((s) => s.settings.channelSortOrder ?? 'alphabetical');
export const useCategoryBarWidth = () => useUIStore((s) => s.settings.categoryBarWidth ?? 160);
export const useGuideOpacity = () => useUIStore((s) => s.settings.guideOpacity ?? 0.95);
export const useTmdbApiKey = () => useUIStore((s) => s.settings.tmdbApiKey ?? null);
export const usePosterDbApiKey = () => useUIStore((s) => s.settings.posterDbApiKey ?? null);
export const useRpdbBackdropsEnabled = () => useUIStore((s) => s.settings.rpdbBackdropsEnabled ?? false);
export const useMovieGenresEnabled = () => useUIStore((s) => s.settings.movieGenresEnabled);
export const useSeriesGenresEnabled = () => useUIStore((s) => s.settings.seriesGenresEnabled);
export const useSettingsLoaded = () => useUIStore((s) => s.settingsLoaded);
export const useVodRefreshHours = () => useUIStore((s) => s.settings.vodRefreshHours ?? 24);
export const useEpgRefreshHours = () => useUIStore((s) => s.settings.epgRefreshHours ?? 6);
export const useAllowLanSources = () => useUIStore((s) => s.settings.allowLanSources ?? false);
export const useDebugLoggingEnabled = () => useUIStore((s) => s.settings.debugLoggingEnabled ?? false);
export const useAutoUpdateEnabled = () => useUIStore((s) => s.settings.autoUpdateEnabled ?? true);
export const useUpdateSettings = () => useUIStore((s) => s.updateSettings);

// Search query selectors
export const useMoviesSearchQuery = () => useUIStore((s) => s.moviesSearchQuery);
export const useSetMoviesSearchQuery = () => useUIStore((s) => s.setMoviesSearchQuery);
export const useSeriesSearchQuery = () => useUIStore((s) => s.seriesSearchQuery);
export const useSetSeriesSearchQuery = () => useUIStore((s) => s.setSeriesSearchQuery);

// Scroll position selectors (home)
export const useMoviesHomeScrollPosition = () => useUIStore((s) => s.moviesHomeScrollPosition);
export const useSetMoviesHomeScrollPosition = () => useUIStore((s) => s.setMoviesHomeScrollPosition);
export const useSeriesHomeScrollPosition = () => useUIStore((s) => s.seriesHomeScrollPosition);
export const useSetSeriesHomeScrollPosition = () => useUIStore((s) => s.setSeriesHomeScrollPosition);

// Detail item selectors
export const useMoviesDetailItem = () => useUIStore((s) => s.moviesDetailItem);
export const useSetMoviesDetailItem = () => useUIStore((s) => s.setMoviesDetailItem);
export const useSeriesDetailItem = () => useUIStore((s) => s.seriesDetailItem);
export const useSetSeriesDetailItem = () => useUIStore((s) => s.setSeriesDetailItem);

// Page collapsed selectors
export const useMoviesPageCollapsed = () => useUIStore((s) => s.moviesPageCollapsed);
export const useSetMoviesPageCollapsed = () => useUIStore((s) => s.setMoviesPageCollapsed);
export const useSeriesPageCollapsed = () => useUIStore((s) => s.seriesPageCollapsed);
export const useSetSeriesPageCollapsed = () => useUIStore((s) => s.setSeriesPageCollapsed);

// Updater selectors
export const useUpdaterState = () => useUIStore((s) => s.updaterState);
export const useUpdaterDismissed = () => useUIStore((s) => s.updaterDismissed);
export const useSetUpdaterState = () => useUIStore((s) => s.setUpdaterState);
export const useSetUpdaterDownloadProgress = () => useUIStore((s) => s.setUpdaterDownloadProgress);
export const useDismissUpdater = () => useUIStore((s) => s.dismissUpdater);

// Convenience hook - selects movies or series navigation state by type
export function useVodNavigation(type: 'movie' | 'series') {
  const isMovies = type === 'movie';
  return {
    selectedCategoryId: useUIStore((s) => isMovies ? s.moviesSelectedCategory : s.seriesSelectedCategory),
    setSelectedCategoryId: useUIStore((s) => isMovies ? s.setMoviesSelectedCategory : s.setSeriesSelectedCategory),
    searchQuery: useUIStore((s) => isMovies ? s.moviesSearchQuery : s.seriesSearchQuery),
    setSearchQuery: useUIStore((s) => isMovies ? s.setMoviesSearchQuery : s.setSeriesSearchQuery),
    scrollPosition: useUIStore((s) => isMovies ? s.moviesHomeScrollPosition : s.seriesHomeScrollPosition),
    setScrollPosition: useUIStore((s) => isMovies ? s.setMoviesHomeScrollPosition : s.setSeriesHomeScrollPosition),
    detailItem: useUIStore((s) => isMovies ? s.moviesDetailItem : s.seriesDetailItem),
    setDetailItem: useUIStore((s) => isMovies ? s.setMoviesDetailItem : s.setSeriesDetailItem),
    isPageCollapsed: useUIStore((s) => isMovies ? s.moviesPageCollapsed : s.seriesPageCollapsed),
    setPageCollapsed: useUIStore((s) => isMovies ? s.setMoviesPageCollapsed : s.setSeriesPageCollapsed),
  };
}
