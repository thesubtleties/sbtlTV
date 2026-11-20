// packages/ui/src/services/sync/outbox.ts
/** This computer's changes to sync (only while sync is on; main checks again). */
import type { SyncRecord } from '@sbtltv/core';
import { db, type StoredFavorite } from '../../db';
import { data } from '../../data/client';
import { useUIStore } from '../../stores/uiStore';
import { rowsToRecords } from './records';
import { favoriteIds, favoriteRecord, localId } from './favorites';
import { debugLog } from '../../utils/debugLog';

let active = false;
export function setSyncActive(on: boolean): void { active = on; }

export function syncOut(records: (SyncRecord | null)[]): void {
  if (!active) return;
  const list = records.filter((r): r is SyncRecord => r !== null);
  if (list.length) void window.sync?.record(list);
}

/** Everything this computer has, when sync starts here (join, or the other computer joined). */
export async function sendSnapshot(): Promise<void> {
  const [watchlist, progress] = await Promise.all([db.watchlist.toArray(), db.watchProgress.toArray()]);
  // Favorites can't hold back the watchlist and progress: a failed channel lookup leaves them out this time
  const favs = await favoriteSnapshot().catch((e: unknown) => { debugLog(`Sync: favorites left out of the snapshot (${e instanceof Error ? e.name : 'error'})`, 'sync'); return []; });
  await window.sync?.record([...rowsToRecords(watchlist, progress), ...favs]);
}

/** A guide id for each channel, best effort: the guide's match, else the provider's tvg-id. */
export async function guidesFor(streamIds: string[]): Promise<Map<string, string>> {
  if (!streamIds.length) return new Map();
  try {
    const rows = await data.query({ type: 'favoriteGuides', streamIds });
    return new Map(rows.filter((r) => r.guide).map((r) => [r.stream_id, r.guide]));
  } catch (e) {
    debugLog(`Sync: favorite guide ids not read (${e instanceof Error ? e.name : 'error'})`, 'sync');
    return new Map();
  }
}

/** Every channel favorite under every id it answers to; a favorite from before Sync gets its own id saved now. */
async function favoriteSnapshot(): Promise<SyncRecord[]> {
  const sources = useUIStore.getState().sources;
  const rows = await db.favorites.where('type').equals('channel').toArray();
  const unsaved = rows.filter((f) => !f.ids?.length && f.stream_id);
  const guides = await guidesFor(unsaved.map((f) => f.stream_id!));
  const out: SyncRecord[] = [];
  for (const f of rows) {
    let ids = f.ids ?? [];
    if (!ids.length && f.stream_id) {
      const own = localId(f.stream_id, sources, guides.get(f.stream_id));
      if (own) { ids = [own]; await db.favorites.update(f.id, { ids }); }
    }
    for (const i of ids) out.push(favoriteRecord({ ...i, name: f.name ?? '' }, +f.added));
  }
  return out;
}

/** A favorite made here: the other computers follow (only while sync is on). */
export function favoriteAdded(row: StoredFavorite): void {
  const ids = favoriteIds(row, useUIStore.getState().sources);
  syncOut(ids.map((i) => favoriteRecord({ ...i, name: row.name ?? '' }, +row.added)));
}

/** A favorite unfavorited here: removed under every id it answers to, so every computer drops it. No lookup needed. */
export function favoriteRemoved(row: StoredFavorite, at = Date.now()): void {
  const ids = favoriteIds(row, useUIStore.getState().sources);
  syncOut(ids.map((i) => favoriteRecord({ ...i, name: row.name ?? '' }, at, true)));
}
