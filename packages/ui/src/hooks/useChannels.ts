import { useLiveQuery } from 'dexie-react-hooks';
import { db, getLastCategory, setLastCategory } from '../db';
import type { StoredChannel, StoredCategory, SourceMeta, StoredProgram } from '../db';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useEnabledSourceIds, useLiveSourceOrder, useSourceMap } from './useSourceFiltering';
import { sortCategoryGroups, resolveGroupPrimary } from './categorySort';
import { useCategorySortOrder } from '../stores/uiStore';

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

// Programs are indexed on [stream_id+start]. Reading a channel's whole week
// and filtering in JS was fine at 65k rows and slow at 500k; bound the start
// time instead. A program that began before the window but is still running
// is caught by looking back MAX_PROGRAM_MS.
const MAX_PROGRAM_MS = 24 * 60 * 60 * 1000;

async function programsStartingBetween(streamIds: string[], lower: Date, upper: Date): Promise<StoredProgram[]> {
  if (streamIds.length === 0 || upper < lower) return [];
  const ranges = streamIds.map((id) => [[id, lower], [id, upper]] as [[string, Date], [string, Date]]);
  return db.programs
    .where('[stream_id+start]')
    .inAnyRange(ranges, { includeLowers: true, includeUppers: true })
    .toArray();
}

// Latest-starting program per channel that is on air at `now`.
function currentProgramsFrom(programs: StoredProgram[], now: Date): Map<string, StoredProgram> {
  const current = new Map<string, StoredProgram>();
  for (const program of programs) {
    if (program.start <= now && program.end > now) {
      const existing = current.get(program.stream_id);
      if (!existing || program.start > existing.start) current.set(program.stream_id, program);
    }
  }
  return current;
}

// Hook to get current program for a channel
export function useCurrentProgram(streamId: string | null): StoredProgram | null {
  const program = useLiveQuery(
    async () => {
      if (!streamId) return null;
      const now = new Date();
      const candidates = await programsStartingBetween([streamId], new Date(now.getTime() - MAX_PROGRAM_MS), now);
      return currentProgramsFrom(candidates, now).get(streamId) ?? null;
    },
    [streamId]
  );
  return program ?? null;
}

// Hook to get all programs for channels within a time range (for EPG grid).
// The map only holds entries for the requested stream IDs, so a missing entry
// means "not read yet" and an empty array means "no EPG for this channel".
// While a new set of IDs or a new window is being read, the previous map is
// returned so rows already on screen keep their programs instead of flashing.
export function useProgramsInRange(
  streamIds: string[],
  windowStart: Date,
  windowEnd: Date
): Map<string, StoredProgram[]> {
  const lastPrograms = useRef<Map<string, StoredProgram[]>>(new Map());
  const programs = useLiveQuery(
    async () => {
      if (streamIds.length === 0) return new Map<string, StoredProgram[]>();

      const result = new Map<string, StoredProgram[]>();
      for (const id of streamIds) {
        result.set(id, []);
      }

      // Overlap: program.start < windowEnd AND program.end > windowStart.
      const lower = new Date(windowStart.getTime() - MAX_PROGRAM_MS);
      const upper = new Date(windowEnd.getTime() - 1);
      const overlapping = (await programsStartingBetween(streamIds, lower, upper))
        .filter((program) => program.end > windowStart);

      for (const program of overlapping) {
        result.get(program.stream_id)?.push(program);
      }
      for (const [, progs] of result) {
        progs.sort((a, b) => a.start.getTime() - b.start.getTime());
      }

      return result;
    },
    [streamIds.join(','), windowStart.getTime(), windowEnd.getTime()]
  );

  if (programs) lastPrograms.current = programs;
  return lastPrograms.current;
}

// Hook to get the current program for a list of channel IDs (queries local DB - EPG is synced upfront)
export function usePrograms(streamIds: string[]): Map<string, StoredProgram | null> {
  const programs = useLiveQuery(
    async () => {
      if (streamIds.length === 0) return new Map();
      const now = new Date();
      const candidates = await programsStartingBetween(streamIds, new Date(now.getTime() - MAX_PROGRAM_MS), now);
      const current = currentProgramsFrom(candidates, now);
      const result = new Map<string, StoredProgram | null>();
      for (const id of streamIds) {
        result.set(id, current.get(id) ?? null);
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
    position: number;        // provider position of this category within its source (Infinity if unknown)
  }[];
  totalCount: number;
  primaryPriority: number;   // source priority of sources[0] (lower = higher priority)
  primaryPosition: number;   // position of sources[0]'s category (Infinity if unknown)
}

// Hook to get categories grouped by name for adaptive display.
// Single-source categories render as a normal clickable item.
// Multi-source categories render as a header with per-source sub-items.
export function useGroupedCategories(): GroupedCategory[] {
  const categoriesWithCounts = useCategoriesWithCounts();
  const liveSourceOrder = useLiveSourceOrder();
  const sourceMap = useSourceMap();
  const categorySortOrder = useCategorySortOrder();

  return useMemo(() => {
    // Group categories by normalized name
    const grouped = new Map<string, GroupedCategory>();

    for (const cat of categoriesWithCounts) {
      if (cat.channelCount === 0) continue;
      // Skip categories from unknown/deleted sources
      if (sourceMap.size > 0 && !sourceMap.has(cat.source_id)) continue;

      const normalizedName = cat.category_name.trim();
      const existing = grouped.get(normalizedName);
      const sourceName = sourceMap.get(cat.source_id)?.name ?? cat.source_id;

      const entry = {
        sourceId: cat.source_id,
        sourceName,
        categoryId: cat.category_id,
        channelCount: cat.channelCount,
        position: cat.position ?? Number.POSITIVE_INFINITY,
      };

      if (existing) {
        existing.sources.push(entry);
        existing.totalCount += cat.channelCount;
      } else {
        grouped.set(normalizedName, {
          name: normalizedName,
          sources: [entry],
          totalCount: cat.channelCount,
          primaryPriority: 999,
          primaryPosition: Number.POSITIVE_INFINITY,
        });
      }
    }

    // Order each group's sub-items by live source priority + resolve its primary
    const orderIndex = new Map(liveSourceOrder.map((id, i) => [id, i]));
    for (const group of grouped.values()) {
      const { primaryPriority, primaryPosition } = resolveGroupPrimary(group.sources, orderIndex);
      group.primaryPriority = primaryPriority;
      group.primaryPosition = primaryPosition;
    }

    // Sort groups by the active order (alphabetical default, or provider order)
    return sortCategoryGroups(Array.from(grouped.values()), categorySortOrder);
  }, [categoriesWithCounts, liveSourceOrder, sourceMap, categorySortOrder]);
}
