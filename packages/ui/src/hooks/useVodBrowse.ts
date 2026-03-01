import { useState, useEffect } from 'react';
import { db, type StoredMovie, type StoredSeries } from '../db';
import { useEnabledSourceIds } from './useSourceFiltering';

// ===========================================================================
// Browse Hooks (for gallery view with Virtuoso)
// ===========================================================================

/**
 * All movies for browse view (optionally filtered by category, source-aware)
 * Returns items sorted alphabetically - Virtuoso handles virtualization
 * Pass null for categoryIds to get ALL movies, or array of category IDs to filter
 */
export function usePaginatedMovies(categoryIds: string[] | null, search?: string) {
  const enabledIds = useEnabledSourceIds();
  const [items, setItems] = useState<StoredMovie[]>([]);
  const [loading, setLoading] = useState(false);
  const categoryKey = categoryIds?.join(',') ?? null;

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        let result: StoredMovie[];

        if (categoryIds && categoryIds.length === 1) {
          result = await db.vodMovies.where('category_ids').equals(categoryIds[0]).toArray();
        } else if (categoryIds && categoryIds.length > 1) {
          result = await db.vodMovies.where('category_ids').anyOf(categoryIds).toArray();
        } else {
          result = await db.vodMovies.toArray();
        }

        // Filter by enabled sources
        if (enabledIds.length > 0) {
          const enabledSet = new Set(enabledIds);
          result = result.filter(m => enabledSet.has(m.source_id));
        }

        // Apply search filter
        if (search) {
          const searchLower = search.toLowerCase();
          result = result.filter(m => m.name.toLowerCase().includes(searchLower));
        }

        // Sort alphabetically
        result.sort((a, b) => a.name.localeCompare(b.name));

        setItems(result);
      } finally {
        setLoading(false);
      }
    };

    fetchAll();
  }, [categoryKey, search, enabledIds]);

  return {
    items,
    loading,
    hasMore: false,
    loadMore: () => {},
  };
}

/**
 * All series for browse view (optionally filtered by category, source-aware)
 * Returns items sorted alphabetically - Virtuoso handles virtualization
 * Pass null for categoryIds to get ALL series, or array of category IDs to filter
 */
export function usePaginatedSeries(categoryIds: string[] | null, search?: string) {
  const enabledIds = useEnabledSourceIds();
  const [items, setItems] = useState<StoredSeries[]>([]);
  const [loading, setLoading] = useState(false);
  const categoryKey = categoryIds?.join(',') ?? null;

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        let result: StoredSeries[];

        if (categoryIds && categoryIds.length === 1) {
          result = await db.vodSeries.where('category_ids').equals(categoryIds[0]).toArray();
        } else if (categoryIds && categoryIds.length > 1) {
          result = await db.vodSeries.where('category_ids').anyOf(categoryIds).toArray();
        } else {
          result = await db.vodSeries.toArray();
        }

        // Filter by enabled sources
        if (enabledIds.length > 0) {
          const enabledSet = new Set(enabledIds);
          result = result.filter(s => enabledSet.has(s.source_id));
        }

        // Apply search filter
        if (search) {
          const searchLower = search.toLowerCase();
          result = result.filter(s => s.name.toLowerCase().includes(searchLower));
        }

        // Sort alphabetically
        result.sort((a, b) => a.name.localeCompare(b.name));

        setItems(result);
      } finally {
        setLoading(false);
      }
    };

    fetchAll();
  }, [categoryKey, search, enabledIds]);

  return {
    items,
    loading,
    hasMore: false,
    loadMore: () => {},
  };
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
