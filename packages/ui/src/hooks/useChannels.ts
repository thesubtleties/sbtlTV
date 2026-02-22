import { useLiveQuery } from 'dexie-react-hooks';
import { db, getLastCategory, setLastCategory } from '../db';
import type { StoredChannel, StoredCategory, SourceMeta, StoredProgram } from '../db';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useEnabledSourceIds, useLiveSourceOrder, useSourceMap } from './useSourceFiltering';

// Hook to get all categories across enabled sources
export function useCategories() {
  const enabledIds = useEnabledSourceIds();
  const categories = useLiveQuery(
    () => {
      if (enabledIds.length === 0) return db.categories.orderBy('category_name').toArray();
      return db.categories
        .where('source_id').anyOf(enabledIds)
        .sortBy('category_name');
    },
    [enabledIds.join(',')]
  );
  return categories ?? [];
}

// Hook to get categories for a specific source
export function useCategoriesForSource(sourceId: string | null) {
  const categories = useLiveQuery(
    () => (sourceId ? db.categories.where('source_id').equals(sourceId).sortBy('category_name') : db.categories.orderBy('category_name').toArray()),
    [sourceId]
  );
  return categories ?? [];
}

// Hook to get channels for a category (or all if categoryId is null)
// sortOrder: 'alphabetical' (default) or 'number' (by channel_num from provider)
export function useChannels(categoryId: string | null, sortOrder: 'alphabetical' | 'number' = 'alphabetical') {
  const enabledIds = useEnabledSourceIds();
  const channels = useLiveQuery(
    async () => {
      let results: StoredChannel[];
      if (!categoryId) {
        results = await db.channels.toArray();
      } else {
        // Channels in this category
        results = await db.channels.where('category_ids').equals(categoryId).toArray();
      }

      // Filter by enabled sources
      if (enabledIds.length > 0) {
        const enabledSet = new Set(enabledIds);
        results = results.filter(ch => enabledSet.has(ch.source_id));
      }

      // Sort based on preference
      if (sortOrder === 'number') {
        // Sort by channel_num, with channels lacking a number at the end (alphabetically)
        return results.sort((a, b) => {
          const aNum = a.channel_num;
          const bNum = b.channel_num;
          if (aNum !== undefined && bNum !== undefined) {
            return aNum - bNum;
          }
          if (aNum !== undefined) return -1; // a has number, b doesn't
          if (bNum !== undefined) return 1;  // b has number, a doesn't
          return a.name.localeCompare(b.name); // both lack numbers, sort alphabetically
        });
      }
      // Default: alphabetical
      return results.sort((a, b) => a.name.localeCompare(b.name));
    },
    [categoryId, sortOrder, enabledIds.join(',')]
  );
  return channels ?? [];
}

// Hook to get total channel count (from enabled sources)
export function useChannelCount() {
  const enabledIds = useEnabledSourceIds();
  const count = useLiveQuery(
    async () => {
      if (enabledIds.length === 0) return db.channels.count();
      return db.channels.where('source_id').anyOf(enabledIds).count();
    },
    [enabledIds.join(',')]
  );
  return count ?? 0;
}

// Hook to get channel count for a category (from enabled sources)
export function useCategoryChannelCount(categoryId: string) {
  const enabledIds = useEnabledSourceIds();
  const count = useLiveQuery(
    async () => {
      const channels = await db.channels.where('category_ids').equals(categoryId).toArray();
      if (enabledIds.length === 0) return channels.length;
      const enabledSet = new Set(enabledIds);
      return channels.filter(ch => enabledSet.has(ch.source_id)).length;
    },
    [categoryId, enabledIds.join(',')]
  );
  return count ?? 0;
}

// Hook to get sync metadata for all sources
export function useSyncStatus() {
  const status = useLiveQuery(() => db.sourcesMeta.toArray());
  return status ?? [];
}

// Hook to manage selected category with persistence
export function useSelectedCategory() {
  const [categoryId, setCategoryIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load last category on mount
  useEffect(() => {
    getLastCategory().then((lastCat) => {
      setCategoryIdState(lastCat);
      setLoading(false);
    });
  }, []);

  // Wrapper that also persists
  const setCategoryId = useCallback((id: string | null) => {
    setCategoryIdState(id);
    if (id) {
      setLastCategory(id);
    }
  }, []);

  return { categoryId, setCategoryId, loading };
}

// Hook to search channels by name (from enabled sources)
export function useChannelSearch(query: string, limit = 50) {
  const enabledIds = useEnabledSourceIds();
  const channels = useLiveQuery(
    async () => {
      if (!query || query.length < 2) {
        return [];
      }
      const lowerQuery = query.toLowerCase();
      let results = await db.channels
        .filter((ch) => ch.name.toLowerCase().includes(lowerQuery))
        .limit(enabledIds.length > 0 ? limit * 3 : limit) // over-fetch before source filter
        .toArray();

      if (enabledIds.length > 0) {
        const enabledSet = new Set(enabledIds);
        results = results.filter(ch => enabledSet.has(ch.source_id));
      }

      return results.slice(0, limit);
    },
    [query, limit, enabledIds.join(',')]
  );
  return channels ?? [];
}

// Categories with channel counts
export interface CategoryWithCount extends StoredCategory {
  channelCount: number;
}

// Hook to get categories with their channel counts (from enabled sources)
export function useCategoriesWithCounts(): CategoryWithCount[] {
  const enabledIds = useEnabledSourceIds();
  const data = useLiveQuery(async () => {
    let categories: StoredCategory[];
    if (enabledIds.length === 0) {
      categories = await db.categories.orderBy('category_name').toArray();
    } else {
      categories = await db.categories.where('source_id').anyOf(enabledIds).sortBy('category_name');
    }

    const enabledSet = enabledIds.length > 0 ? new Set(enabledIds) : null;
    const withCounts: CategoryWithCount[] = await Promise.all(
      categories.map(async (cat) => {
        const channels = await db.channels.where('category_ids').equals(cat.category_id).toArray();
        const count = enabledSet
          ? channels.filter(ch => enabledSet.has(ch.source_id)).length
          : channels.length;
        return { ...cat, channelCount: count };
      })
    );
    return withCounts;
  }, [enabledIds.join(',')]);
  return data ?? [];
}

// Hook to get current program for a channel
export function useCurrentProgram(streamId: string | null): StoredProgram | null {
  const program = useLiveQuery(
    async () => {
      if (!streamId) return null;
      const now = new Date();
      // Find program where start <= now < end
      const programs = await db.programs
        .where('stream_id')
        .equals(streamId)
        .filter((p) => p.start <= now && p.end > now)
        .first();
      return programs ?? null;
    },
    [streamId]
  );
  return program ?? null;
}

// Hook to get all programs for channels within a time range (for EPG grid)
export function useProgramsInRange(
  streamIds: string[],
  windowStart: Date,
  windowEnd: Date
): Map<string, StoredProgram[]> {
  const programs = useLiveQuery(
    async () => {
      if (streamIds.length === 0) return new Map<string, StoredProgram[]>();

      const result = new Map<string, StoredProgram[]>();

      // Initialize empty arrays for all channels
      for (const id of streamIds) {
        result.set(id, []);
      }

      // Fetch all programs that overlap with the time window
      // A program overlaps if: program.start < windowEnd AND program.end > windowStart
      const allPrograms = await db.programs
        .where('stream_id')
        .anyOf(streamIds)
        .filter((p) => {
          const start = p.start instanceof Date ? p.start : new Date(p.start);
          const end = p.end instanceof Date ? p.end : new Date(p.end);
          return start < windowEnd && end > windowStart;
        })
        .toArray();

      // Group by stream_id and sort by start time
      for (const prog of allPrograms) {
        const existing = result.get(prog.stream_id) ?? [];
        existing.push(prog);
        result.set(prog.stream_id, existing);
      }

      // Sort each channel's programs by start time
      for (const [, progs] of result) {
        progs.sort((a, b) => {
          const aStart = a.start instanceof Date ? a.start.getTime() : new Date(a.start).getTime();
          const bStart = b.start instanceof Date ? b.start.getTime() : new Date(b.start).getTime();
          return aStart - bStart;
        });
      }

      return result;
    },
    [streamIds.join(','), windowStart.getTime(), windowEnd.getTime()]
  );

  return programs ?? new Map();
}

// Hook to get programs for a list of channel IDs (queries local DB - EPG is synced upfront)
export function usePrograms(streamIds: string[]): Map<string, StoredProgram | null> {
  const programs = useLiveQuery(
    async () => {
      if (streamIds.length === 0) return new Map();
      const now = new Date();
      const result = new Map<string, StoredProgram | null>();

      for (const id of streamIds) {
        const program = await db.programs
          .where('stream_id')
          .equals(id)
          .filter((p) => {
            const start = p.start instanceof Date ? p.start : new Date(p.start);
            const end = p.end instanceof Date ? p.end : new Date(p.end);
            return start <= now && end > now;
          })
          .first();
        result.set(id, program ?? null);
      }
      return result;
    },
    [streamIds.join(',')]
  );
  return programs ?? new Map();
}

// Grouped category for adaptive category strip
export interface GroupedCategory {
  name: string;              // Category display name (e.g., "News")
  // Single-source: one entry, clickable directly
  // Multi-source: header with sub-items per source
  sources: {
    sourceId: string;
    sourceName: string;
    categoryId: string;
    channelCount: number;
  }[];
  totalCount: number;
}

// Hook to get categories grouped by name for adaptive display.
// Single-source categories render as a normal clickable item.
// Multi-source categories render as a header with per-source sub-items.
export function useGroupedCategories(): GroupedCategory[] {
  const categoriesWithCounts = useCategoriesWithCounts();
  const liveSourceOrder = useLiveSourceOrder();
  const sourceMap = useSourceMap();

  return useMemo(() => {
    // Group categories by normalized name
    const grouped = new Map<string, GroupedCategory>();

    for (const cat of categoriesWithCounts) {
      if (cat.channelCount === 0) continue;

      const normalizedName = cat.category_name.trim();
      const existing = grouped.get(normalizedName);
      const sourceName = sourceMap.get(cat.source_id)?.name ?? cat.source_id;

      const entry = {
        sourceId: cat.source_id,
        sourceName,
        categoryId: cat.category_id,
        channelCount: cat.channelCount,
      };

      if (existing) {
        existing.sources.push(entry);
        existing.totalCount += cat.channelCount;
      } else {
        grouped.set(normalizedName, {
          name: normalizedName,
          sources: [entry],
          totalCount: cat.channelCount,
        });
      }
    }

    // Sort sub-items by live source preference order
    const orderIndex = new Map(liveSourceOrder.map((id, i) => [id, i]));
    for (const group of grouped.values()) {
      if (group.sources.length > 1) {
        group.sources.sort((a, b) => {
          const aIdx = orderIndex.get(a.sourceId) ?? 999;
          const bIdx = orderIndex.get(b.sourceId) ?? 999;
          return aIdx - bIdx;
        });
      }
    }

    // Sort groups alphabetically by name
    return Array.from(grouped.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [categoriesWithCounts, liveSourceOrder, sourceMap]);
}
