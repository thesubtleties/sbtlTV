import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type VodCategory } from '../db';
import { useEnabledSourceIds } from './useSourceFiltering';

// ===========================================================================
// Category Hooks
// ===========================================================================

/**
 * Get VOD categories by type (excludes empty categories, filtered by enabled sources)
 */
export function useVodCategories(type: 'movie' | 'series') {
  const enabledIds = useEnabledSourceIds();

  // Phase 1: instant — all categories from the indexed table
  const allCategories = useLiveQuery(async () => {
    let cats = await db.vodCategories.where('type').equals(type).toArray();
    if (enabledIds.length > 0) {
      const enabledSet = new Set(enabledIds);
      cats = cats.filter(cat => enabledSet.has(cat.source_id));
    }
    return cats;
  }, [type, enabledIds.join(',')]);

  // Phase 2: lazy prune — per-category indexed exists check
  const prunedCategories = useLiveQuery(async () => {
    const cats = allCategories;
    if (!cats || cats.length === 0) return undefined;
    const table = type === 'movie' ? db.vodMovies : db.vodSeries;
    // Check each category with a fast indexed lookup (stops at first match)
    const checks = await Promise.all(
      cats.map(async (cat) => {
        const item = await table.where('category_ids').equals(cat.category_id).limit(1).first();
        return item ? cat : null;
      })
    );
    return checks.filter((c): c is VodCategory => c !== null);
  }, [allCategories]);

  return {
    categories: prunedCategories ?? allCategories ?? [],
    loading: allCategories === undefined,
  };
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
