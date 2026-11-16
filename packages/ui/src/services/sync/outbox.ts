// packages/ui/src/services/sync/outbox.ts
/** This computer's changes to sync (only while sync is on; main checks again). */
import type { SyncRecord } from '@sbtltv/core';
import { db } from '../../db';
import { rowsToRecords } from './records';

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
  await window.sync?.record(rowsToRecords(watchlist, progress));
}
