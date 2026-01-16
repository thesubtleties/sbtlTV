import { useLiveQuery } from 'dexie-react-hooks';
import { db, getLastCategory, setLastCategory } from '../db';
import type { StoredChannel, StoredCategory, SourceMeta, StoredProgram } from '../db';
import { useState, useEffect, useCallback } from 'react';

// Hook to get all categories across all sources
export function useCategories() {
  const categories = useLiveQuery(() => db.categories.orderBy('category_name').toArray());
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
export function useChannels(categoryId: string | null) {
  const channels = useLiveQuery(
    () => {
      if (!categoryId) {
        // All channels, sorted by name
        return db.channels.orderBy('name').toArray();
      }
      // Channels in this category
      // category_ids is an array, so we use anyOf pattern
      return db.channels.where('category_ids').equals(categoryId).sortBy('name');
    },
    [categoryId]
  );
  return channels ?? [];
}

// Hook to get total channel count
export function useChannelCount() {
  const count = useLiveQuery(() => db.channels.count());
  return count ?? 0;
}

// Hook to get channel count for a category
export function useCategoryChannelCount(categoryId: string) {
  const count = useLiveQuery(() => db.channels.where('category_ids').equals(categoryId).count(), [categoryId]);
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

// Hook to search channels by name
export function useChannelSearch(query: string, limit = 50) {
  const channels = useLiveQuery(
    () => {
      if (!query || query.length < 2) {
        return [];
      }
      const lowerQuery = query.toLowerCase();
      return db.channels
        .filter((ch) => ch.name.toLowerCase().includes(lowerQuery))
        .limit(limit)
        .toArray();
    },
    [query, limit]
  );
  return channels ?? [];
}

// Categories with channel counts
export interface CategoryWithCount extends StoredCategory {
  channelCount: number;
}

// Hook to get categories with their channel counts
export function useCategoriesWithCounts(): CategoryWithCount[] {
  const data = useLiveQuery(async () => {
    const categories = await db.categories.orderBy('category_name').toArray();
    const withCounts: CategoryWithCount[] = await Promise.all(
      categories.map(async (cat) => {
        const count = await db.channels.where('category_ids').equals(cat.category_id).count();
        return { ...cat, channelCount: count };
      })
    );
    return withCounts;
  });
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

// Hook to get programs for a list of channel IDs (queries local DB - EPG is synced upfront)
export function usePrograms(streamIds: string[]): Map<string, StoredProgram | null> {
  const programs = useLiveQuery(
    async () => {
      if (streamIds.length === 0) return new Map();
      const now = new Date();
      const result = new Map<string, StoredProgram | null>();

      // Debug: check total program count
      const totalCount = await db.programs.count();
      if (totalCount === 0) {
        console.log('EPG Debug: No programs in database');
      } else {
        console.log(`EPG Debug: ${totalCount} programs in database`);
      }

      for (const id of streamIds.slice(0, 5)) { // Debug first 5 only
        const allForChannel = await db.programs
          .where('stream_id')
          .equals(id)
          .toArray();

        if (allForChannel.length > 0) {
          console.log(`EPG Debug for ${id}:`, {
            count: allForChannel.length,
            first: allForChannel[0],
            now: now.toISOString(),
            firstStart: allForChannel[0].start,
            firstEnd: allForChannel[0].end,
          });
        }
      }

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
