import { useMemo } from 'react';
import { useDataQuery } from '../data/useDataQuery';
import { useEnabledSourceIds } from './useSourceFiltering';

// ===========================================================================
// Category Hooks
// ===========================================================================

/**
 * Get VOD categories by type (excludes empty categories, filtered by enabled sources).
 * The query already prunes categories with nothing in them.
 */
export function useVodCategories(type: 'movie' | 'series') {
  const enabledIds = useEnabledSourceIds();
  const { data, loading } = useDataQuery(
    { type: 'vodCategories', kind: type, sourceIds: enabledIds },
    ['vod_categories', 'vod_movies', 'vod_series'], [type, enabledIds.join(',')],
  );
  return { categories: data ?? [], loading };
}

// Grouped VOD category (deduped by name across sources)
export interface GroupedVodCategory {
  name: string;
  categoryIds: string[];
  groupKey: string; // `vgrp_${name}` — stable, won't collide with raw numeric category_ids
}

/**
 * Group VOD categories by name (same dedup pattern as live TV's useGroupedCategories)
 * Merges categories with the same name across sources into one entry
 */
export function useGroupedVodCategories(type: 'movie' | 'series') {
  const { categories, loading } = useVodCategories(type);

  const grouped = useMemo((): GroupedVodCategory[] => {
    const groupMap = new Map<string, GroupedVodCategory>();

    for (const cat of categories) {
      const normalizedName = cat.name.trim();
      const existing = groupMap.get(normalizedName);

      if (existing) {
        existing.categoryIds.push(cat.category_id);
      } else {
        groupMap.set(normalizedName, {
          name: normalizedName,
          categoryIds: [cat.category_id],
          groupKey: `vgrp_${normalizedName}`,
        });
      }
    }

    return Array.from(groupMap.values());
  }, [categories]);

  return { groupedCategories: grouped, loading };
}
