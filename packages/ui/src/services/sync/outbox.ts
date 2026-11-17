// packages/ui/src/services/sync/outbox.ts
/** This computer's changes to sync (only while sync is on; main checks again). */
import type { SyncRecord } from '@sbtltv/core';
import { db, type StoredFavorite } from '../../db';
import { data } from '../../data/client';
import { useUIStore } from '../../stores/uiStore';
import { rowsToRecords } from './records';
import { favoriteIdentity, favoriteRecord } from './favorites';

let active = false;
export function setSyncActive(on: boolean): void { active = on; }

export function syncOut(records: (SyncRecord | null)[]): void {
  if (!active) return;
  const list = records.filter((r): r is SyncRecord => r !== null);
  if (list.length) void window.sync?.record(list);
}

/** Everything this computer has, when sync starts here (join, or the other computer joined). */
export async function sendSnapshot(): Promise<void> {
  const [watchlist, progress, favorites] = await Promise.all([db.watchlist.toArray(), db.watchProgress.toArray(), db.favorites.where('type').equals('channel').toArray()]);
  const favs = await favoriteRecords(favorites, (f) => +f.added);
  await window.sync?.record([...rowsToRecords(watchlist, progress), ...favs]);
}

/** Channel favorites as Sync records: each one's server, channel id and guide id (or the identity it came with). */
async function favoriteRecords(rows: StoredFavorite[], at: (f: StoredFavorite) => number, removed = false): Promise<SyncRecord[]> {
  const sources = useUIStore.getState().sources;
  const need = rows.filter((f) => !f.sync && f.stream_id).map((f) => f.stream_id!);
  const channels = need.length ? await data.query({ type: 'channelsByIds', streamIds: need }) : [];
  const byId = new Map(channels.map((c) => [c.stream_id, c]));
  return rows.flatMap((f) => {
    const identity = favoriteIdentity(f, { sources, channel: f.stream_id ? byId.get(f.stream_id) : undefined });
    return identity ? [favoriteRecord({ ...identity, name: f.name ?? '' }, at(f), removed)] : [];
  });
}

/** A favorite added or removed here: the other computers follow (only while sync is on). */
export async function favoritesOut(rows: StoredFavorite[], at: number, removed = false): Promise<void> {
  if (!active) return;
  try { syncOut(await favoriteRecords(rows, () => at, removed)); } catch { /* the channel lookup failed: the next snapshot carries it */ }
}
