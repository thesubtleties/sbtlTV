import { useState, useEffect, useMemo } from 'react';
import type { MovieRow, SeriesRow } from '@sbtltv/core';
import { useDataQuery } from '../data/useDataQuery';
import { useEnabledSourceIds } from './useSourceFiltering';

// ===========================================================================
// Browse Hooks (for gallery view with Virtuoso)
// ===========================================================================

function selector(categoryIds: string[] | null) {
  return categoryIds && categoryIds.length > 0 ? { kind: 'categories' as const, categoryIds } : { kind: 'all' as const };
}

function applySearch<T extends { name: string }>(items: T[] | undefined, search?: string): T[] {
  if (!items) return [];
  if (!search) return items;
  const q = search.toLowerCase();
  return items.filter((m) => m.name.toLowerCase().includes(q));
}

/**
 * All movies for browse view (optionally filtered by category, source-aware)
 * Returns items sorted alphabetically - Virtuoso handles virtualization
 * Pass null for categoryIds to get ALL movies, or array of category IDs to filter
 */
export function usePaginatedMovies(categoryIds: string[] | null, search?: string) {
  const enabledIds = useEnabledSourceIds();
  const { data, loading } = useDataQuery(
    { type: 'movies', by: selector(categoryIds), sourceIds: enabledIds },
    ['vod_movies'], [categoryIds?.join(',') ?? null, enabledIds.join(',')],
  );
  const items: MovieRow[] = useMemo(() => applySearch(data, search), [data, search]);
  return { items, loading, hasMore: false, loadMore: () => {} };
}

/**
 * All series for browse view (optionally filtered by category, source-aware)
 */
export function usePaginatedSeries(categoryIds: string[] | null, search?: string) {
  const enabledIds = useEnabledSourceIds();
  const { data, loading } = useDataQuery(
    { type: 'series', by: selector(categoryIds), sourceIds: enabledIds },
    ['vod_series'], [categoryIds?.join(',') ?? null, enabledIds.join(',')],
  );
  const items: SeriesRow[] = useMemo(() => applySearch(data, search), [data, search]);
  return { items, loading, hasMore: false, loadMore: () => {} };
}

/**
 * Get alphabet index for A-Z rail
 * Returns map of letter -> first item index for that letter
 */
export function useAlphabetIndex(items: Array<{ name: string }>) {
  const [index, setIndex] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    const newIndex = new Map<string, number>();
    items.forEach((item, i) => {
      const firstChar = item.name.charAt(0).toUpperCase();
      const letter = /[A-Z]/.test(firstChar) ? firstChar : '#';
      if (!newIndex.has(letter)) {
        newIndex.set(letter, i);
      }
    });
    setIndex(newIndex);
  }, [items]);

  return index;
}

/**
 * Get current letter based on scroll position
 */
export function useCurrentLetter(
  items: Array<{ name: string }>,
  visibleStartIndex: number
): string {
  if (items.length === 0 || visibleStartIndex < 0) return 'A';

  const currentItem = items[Math.min(visibleStartIndex, items.length - 1)];
  if (!currentItem) return 'A';

  const firstChar = currentItem.name.charAt(0).toUpperCase();
  return /[A-Z]/.test(firstChar) ? firstChar : '#';
}
