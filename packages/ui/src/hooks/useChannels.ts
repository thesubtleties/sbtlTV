import { getLastCategory, setLastCategory } from '../db';
import type { CategoryRow, ChannelRow, ProgramRow, SourceMetaRow } from '@sbtltv/core';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useDataQuery } from '../data/useDataQuery';
import { useEnabledSourceIds, useLiveSourceOrder, useSourceMap } from './useSourceFiltering';
import { sortCategoryGroups, resolveGroupPrimary } from './categorySort';
import { useCategorySortOrder } from '../stores/uiStore';

// The guide's rows come from the data process now; these keep the names callers use.
export type StoredCategory = CategoryRow;
export type StoredChannel = ChannelRow;
export type StoredProgram = ProgramRow;
export type SourceMeta = SourceMetaRow;

// Hook to get all categories across enabled sources
export function useCategories(): StoredCategory[] {
  const enabledIds = useEnabledSourceIds();
  const { data } = useDataQuery({ type: 'categories', sourceIds: enabledIds }, ['categories', 'channels'], [enabledIds.join(',')]);
  return data ?? [];
}

// Hook to get categories for a specific source
export function useCategoriesForSource(sourceId: string | null): StoredCategory[] {
  const { data } = useDataQuery({ type: 'categories', sourceIds: sourceId ? [sourceId] : [] }, ['categories', 'channels'], [sourceId]);
  return data ?? [];
}

// Hook to get channels for a category (or all if categoryId is null)
// sortOrder: 'alphabetical' (default) or 'number' (by channel_num from provider)
export function useChannels(categoryId: string | null, sortOrder: 'alphabetical' | 'number' = 'alphabetical'): StoredChannel[] {
  const enabledIds = useEnabledSourceIds();
  const { data } = useDataQuery(
    { type: 'channels', categoryId, sourceIds: enabledIds, sort: sortOrder },
    ['channels', 'categories'],
    [categoryId, sortOrder, enabledIds.join(',')],
  );
  return data ?? [];
}

// Hook to get total channel count (from enabled sources)
export function useChannelCount(): number {
  const enabledIds = useEnabledSourceIds();
  const { data } = useDataQuery({ type: 'channelCount', sourceIds: enabledIds }, ['channels'], [enabledIds.join(',')]);
  return data ?? 0;
}

// Hook to get sync metadata for all sources
export function useSyncStatus(): SourceMeta[] {
  const { data } = useDataQuery({ type: 'syncStatus' }, ['sources_meta'], []);
  return data ?? [];
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
export function useChannelSearch(query: string, limit = 50): StoredChannel[] {
  const enabledIds = useEnabledSourceIds();
  const active = query.length >= 2;
  const { data } = useDataQuery(
    active ? { type: 'channelSearch', query, sourceIds: enabledIds, limit } : null,
    ['channels'],
    [active ? query : '', limit, enabledIds.join(',')],
  );
  return active ? (data ?? []) : [];
}

// Categories with channel counts
export interface CategoryWithCount extends StoredCategory {
  channelCount: number;
}

// Hook to get categories with their channel counts (from enabled sources).
// The counts ride along with the categories query.
export function useCategoriesWithCounts(): CategoryWithCount[] {
  const categories = useCategories();
  return useMemo(() => categories.map((c) => ({ ...c, channelCount: c.channel_count ?? 0 })), [categories]);
}

// Hook to get current program for a channel
export function useCurrentProgram(streamId: string | null): StoredProgram | null {
  const nowMinute = Math.floor(Date.now() / 60_000) * 60_000;
  const { data } = useDataQuery(
    streamId ? { type: 'currentProgram', streamId, nowMs: nowMinute } : null,
    ['epg_programs', 'epg_links'],
    [streamId, nowMinute],
  );
  return data ?? null;
}

export function groupProgramsByStream(streamIds: string[], rows: StoredProgram[]): Map<string, StoredProgram[]> {
  const result = new Map<string, StoredProgram[]>();
  for (const id of streamIds) result.set(id, []);
  for (const row of rows) result.get(row.stream_id)?.push(row);
  return result;
}

// Hook to get all programs for channels within a time range (for EPG grid).
// The map only holds entries for the requested stream IDs, so a missing entry
// means "not read yet" and an empty array means "no EPG for this channel".
// While a new set of IDs or a new window is being read, the previous map is
// returned so rows already on screen keep their programs instead of flashing.
// Both EPG tables are watched so a rematch (links only) refreshes the guide.
export function useProgramsInRange(streamIds: string[], windowStart: Date, windowEnd: Date): Map<string, StoredProgram[]> {
  const { data, stale } = useDataQuery(
    streamIds.length > 0 ? { type: 'programsInRange', streamIds, windowStartMs: windowStart.getTime(), windowEndMs: windowEnd.getTime() } : null,
    ['epg_programs', 'epg_links'],
    [streamIds.join(','), windowStart.getTime(), windowEnd.getTime()],
  );
  const last = useRef<Map<string, StoredProgram[]>>(new Map());
  // Rows fetched for an earlier set of ids must not be grouped against the new
  // ids: that would report every new row as "no EPG" instead of "not read yet".
  if (data && !stale) last.current = groupProgramsByStream(streamIds, data);
  return last.current;
}

// Hook to get the current program for a list of channel IDs
export function usePrograms(streamIds: string[]): Map<string, StoredProgram | null> {
  const nowMinute = Math.floor(Date.now() / 60_000) * 60_000;
  const { data: fetched, stale } = useDataQuery(
    streamIds.length > 0 ? { type: 'programsInRange', streamIds, windowStartMs: nowMinute, windowEndMs: nowMinute + 1 } : null,
    ['epg_programs', 'epg_links'],
    [streamIds.join(','), nowMinute],
  );
  const data = stale ? undefined : fetched;
  return useMemo(() => {
    const result = new Map<string, StoredProgram | null>();
    for (const id of streamIds) result.set(id, null);
    for (const row of data ?? []) {
      if (row.start.getTime() <= nowMinute && row.end.getTime() > nowMinute) {
        const cur = result.get(row.stream_id);
        if (!cur || row.start > cur.start) result.set(row.stream_id, row);
      }
    }
    return result;
  }, [data, streamIds.join(','), nowMinute]); // eslint-disable-line react-hooks/exhaustive-deps
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
