import { useMemo, useCallback } from 'react';
import { useUIStore } from '../stores/uiStore';
import type { Source } from '../types/electron';

/**
 * Get IDs of all enabled sources.
 * Returns empty array if sources aren't loaded yet (treat as "show nothing" until ready).
 */
export function useEnabledSourceIds(): string[] {
  const sources = useUIStore((s) => s.sources);
  const sourcesLoaded = useUIStore((s) => s.sourcesLoaded);

  return useMemo(() => {
    if (!sourcesLoaded) return [];
    const enabled = sources.filter(s => s.enabled);
    // All sources enabled (including single-source) → return [] ("show all")
    // This prevents the dep change from [] → [id] that triggers double-query waves
    if (enabled.length === sources.length) return [];
    return enabled.map(s => s.id);
  }, [sources, sourcesLoaded]);
}

/**
 * Get enabled sources as full objects.
 */
export function useEnabledSources(): Source[] {
  const sources = useUIStore((s) => s.sources);
  const sourcesLoaded = useUIStore((s) => s.sourcesLoaded);

  return useMemo(() => {
    if (!sourcesLoaded) return [];
    return sources.filter(s => s.enabled);
  }, [sources, sourcesLoaded]);
}

/**
 * Live TV source priority order.
 * Falls back to insertion order if no custom order is set.
 */
export function useLiveSourceOrder(): string[] {
  const sources = useUIStore((s) => s.sources);
  const liveSourceOrder = useUIStore((s) => s.settings.liveSourceOrder);

  return useMemo(() => {
    if (liveSourceOrder && liveSourceOrder.length > 0) {
      return liveSourceOrder;
    }
    // Default: insertion order of all sources (live includes all types)
    return sources.filter(s => s.enabled).map(s => s.id);
  }, [sources, liveSourceOrder]);
}

/**
 * VOD source priority order (Xtream sources only).
 * Falls back to insertion order if no custom order is set.
 */
export function useVodSourceOrder(): string[] {
  const sources = useUIStore((s) => s.sources);
  const vodSourceOrder = useUIStore((s) => s.settings.vodSourceOrder);

  return useMemo(() => {
    if (vodSourceOrder && vodSourceOrder.length > 0) {
      return vodSourceOrder;
    }
    // Default: insertion order of Xtream sources
    return sources.filter(s => s.enabled && s.type === 'xtream').map(s => s.id);
  }, [sources, vodSourceOrder]);
}

/**
 * Resolve the preferred source for a content item with multiple sources.
 * Returns a function that picks the best source_id from a list, based on preference order.
 */
export function usePreferredSourceResolver(type: 'live' | 'vod') {
  const liveOrder = useLiveSourceOrder();
  const vodOrder = useVodSourceOrder();
  const order = type === 'live' ? liveOrder : vodOrder;

  return useCallback((sourceIds: string[]): string | undefined => {
    if (sourceIds.length === 0) return undefined;
    if (sourceIds.length === 1) return sourceIds[0];

    // Find the first source_id that appears in the preference order
    for (const id of order) {
      if (sourceIds.includes(id)) return id;
    }
    // Fallback to the first available
    return sourceIds[0];
  }, [order]);
}

/**
 * Get source name by ID (for display purposes).
 */
export function useSourceName(sourceId: string | undefined): string {
  const sources = useUIStore((s) => s.sources);

  return useMemo(() => {
    if (!sourceId) return '';
    return sources.find(s => s.id === sourceId)?.name ?? sourceId;
  }, [sources, sourceId]);
}

/**
 * Get source map for quick lookups.
 */
export function useSourceMap(): Map<string, Source> {
  const sources = useUIStore((s) => s.sources);

  return useMemo(() => {
    return new Map(sources.map(s => [s.id, s]));
  }, [sources]);
}
