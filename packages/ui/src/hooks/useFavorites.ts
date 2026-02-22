import { useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useEnabledSourceIds } from './useSourceFiltering';

function favId(streamId: string): string {
  return `channel_${streamId}`;
}

export function useIsFavoriteChannel(streamId: string | undefined): boolean {
  const fav = useLiveQuery(
    () => streamId ? db.favorites.get(favId(streamId)) : undefined,
    [streamId]
  );
  return fav !== undefined && fav !== null;
}

export function useToggleFavoriteChannel() {
  return useCallback(async (streamId: string, name: string) => {
    const id = favId(streamId);
    const existing = await db.favorites.get(id);
    if (existing) {
      await db.favorites.delete(id);
    } else {
      await db.favorites.put({
        id,
        type: 'channel',
        stream_id: streamId,
        name,
        added: new Date(),
      });
    }
  }, []);
}

export function useFavoriteChannels() {
  const enabledIds = useEnabledSourceIds();
  const favorites = useLiveQuery(async () => {
    const favs = await db.favorites.where('type').equals('channel').toArray();
    if (favs.length === 0) return [];

    const streamIds = favs.map(f => f.stream_id).filter(Boolean) as string[];
    const channels = await db.channels.where('stream_id').anyOf(streamIds).toArray();

    if (enabledIds.length > 0) {
      const enabledSet = new Set(enabledIds);
      return channels.filter(ch => enabledSet.has(ch.source_id));
    }
    return channels;
  }, [enabledIds.join(',')]);

  return favorites ?? [];
}

export function useFavoriteChannelCount(): number {
  const channels = useFavoriteChannels();
  return channels.length;
}
