/**
 * UI State Store - Zustand store for transient UI state
 *
 * Stores UI state that should persist during the session but reset on app restart.
 * Designed to be easily extended with backend persistence middleware later.
 */

import { create } from 'zustand';

interface UIState {
  // Movies page
  moviesSelectedCategory: string | null;  // null = home, 'all' = all, string = category id
  setMoviesSelectedCategory: (id: string | null) => void;

  // Series page
  seriesSelectedCategory: string | null;
  setSeriesSelectedCategory: (id: string | null) => void;

  // Sync state - persists across Settings open/close
  channelSyncing: boolean;
  vodSyncing: boolean;
  tmdbMatching: boolean;
  setChannelSyncing: (value: boolean) => void;
  setVodSyncing: (value: boolean) => void;
  setTmdbMatching: (value: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  // Movies
  moviesSelectedCategory: null,
  setMoviesSelectedCategory: (id) => set({ moviesSelectedCategory: id }),

  // Series
  seriesSelectedCategory: null,
  setSeriesSelectedCategory: (id) => set({ seriesSelectedCategory: id }),

  // Sync state
  channelSyncing: false,
  vodSyncing: false,
  tmdbMatching: false,
  setChannelSyncing: (value) => set({ channelSyncing: value }),
  setVodSyncing: (value) => set({ vodSyncing: value }),
  setTmdbMatching: (value) => set({ tmdbMatching: value }),
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
