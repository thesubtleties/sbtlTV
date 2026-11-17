// packages/ui/src/services/sync/records.ts
/** Dexie rows as sync records (TMDB-keyed; rows without TMDB identity don't sync). */
import { mergeRecords, type SyncRecord } from '@sbtltv/core';
import type { StoredWatchProgress, StoredWatchlistItem } from '../../db';

export function watchlistRecord(type: 'movie' | 'series', tmdb: number, name: string, at: number, removed = false): SyncRecord {
  return { k: 'wl', type, tmdb, name, at, ...(removed && { removed: true as const }) };
}

export function progressRecord(row: StoredWatchProgress, removed = false, at = +row.updated_at): SyncRecord | null {
  const base = { name: row.name ?? '', pos: row.position, dur: row.duration, done: row.completed, at, ...(removed && { removed: true as const }) };
  if (row.type === 'movie') return row.tmdb_id ? { k: 'pm', tmdb: row.tmdb_id, ...base } : null;
  if (row.series_tmdb_id && row.season_num != null && row.episode_num != null) return { k: 'pe', series: row.series_tmdb_id, s: row.season_num, e: row.episode_num, ...base };
  return null;
}

export function rowsToRecords(watchlist: StoredWatchlistItem[], progress: StoredWatchProgress[]): SyncRecord[] {
  const out: SyncRecord[] = [];
  for (const w of watchlist) if (w.tmdb_id) out.push(watchlistRecord(w.type, w.tmdb_id, w.name, +w.added));
  for (const p of progress) { const r = progressRecord(p); if (r) out.push(r); }
  return [...mergeRecords([out]).values()];
}
