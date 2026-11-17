import { useCallback, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type StoredFavorite } from '../db';
import { useUIStore } from '../stores/uiStore';
import { waitingFavorites } from '../components/MissingFavorites';
import { useDataQuery } from '../data/useDataQuery';
import { useEnabledSourceIds } from './useSourceFiltering';
import { favoritesOut } from '../services/sync/outbox';

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

/** Favorite or unfavorite a channel; with Sync on, the other computers follow. */
export async function toggleFavoriteChannel(streamId: string, name: string): Promise<void> {
  const id = favId(streamId);
  const existing = await db.favorites.get(id);
  if (existing) {
    await db.favorites.delete(id);
    await favoritesOut([existing], Date.now(), true);
  } else {
    const row = { id, type: 'channel' as const, stream_id: streamId, name, added: new Date() };
    await db.favorites.put(row);
    await favoritesOut([row], +row.added);
  }
}

/** Remove a favorite row as it is (one waiting for its channel too); the other computers follow. */
export async function removeFavoriteRow(row: StoredFavorite): Promise<void> {
  await db.favorites.delete(row.id);
  await favoritesOut([row], Date.now(), true);
}

/** Synced favorites this computer doesn't have, when Settings › Sync & transfer says to show them. */
export function useWaitingFavorites(): StoredFavorite[] {
  const setting = useUIStore((s) => s.settings.syncMissingChannels ?? 'hide');
  const rows = useLiveQuery(() => db.favorites.where('type').equals('channel').toArray(), []);
  return useMemo(() => waitingFavorites(rows ?? [], setting), [rows, setting]);
}

export function useToggleFavoriteChannel() {
  return useCallback((streamId: string, name: string) => toggleFavoriteChannel(streamId, name), []);
}

// Favorites stay on Dexie; the channel rows they point at come from the data
// process. Order follows the favorites table, filtered to enabled sources.
export function useFavoriteChannels() {
  const enabledIds = useEnabledSourceIds();
  const favs = useLiveQuery(() => db.favorites.where('type').equals('channel').toArray(), []);
  const streamIds = useMemo(() => (favs ?? []).map((f) => f.stream_id).filter(Boolean) as string[], [favs]);
  const { data: channels } = useDataQuery(
    streamIds.length > 0 ? { type: 'channelsByIds', streamIds } : null,
    ['channels'],
    [streamIds.join(',')],
  );
  return useMemo(() => {
    if (streamIds.length === 0 || !channels) return [];
    const enabledSet = new Set(enabledIds);
    const order = new Map(streamIds.map((id, i) => [id, i]));
    return channels
      .filter((ch) => enabledIds.length === 0 || enabledSet.has(ch.source_id))
      .sort((a, b) => (order.get(a.stream_id) ?? 0) - (order.get(b.stream_id) ?? 0));
  }, [channels, streamIds, enabledIds]);
}

export function useFavoriteChannelCount(): number {
  const channels = useFavoriteChannels();
  return channels.length;
}
