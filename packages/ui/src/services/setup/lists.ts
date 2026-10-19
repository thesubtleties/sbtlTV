import { db, getLastCategory } from '../../db';

export type ListPart = 'favorites' | 'watchlist' | 'progress';
export interface SetupLists { favorites?: unknown[]; watchlist?: unknown[]; progress?: unknown[]; lastCategory?: string }

const DATE_FIELDS = { favorites: 'added', watchlist: 'added', progress: 'updated_at' } as const;

function toWire(rows: object[]): unknown[] {
  return rows.map((r) => JSON.parse(JSON.stringify(r)));  // Dates become ISO strings
}

/** A row from a file: an object with a string id; its date revived (now, when unreadable). */
function revive<T>(rows: unknown[] | undefined, dateField: string): T[] {
  return (rows ?? []).flatMap((r) => {
    if (!r || typeof r !== 'object' || typeof (r as { id?: unknown }).id !== 'string') return [];
    const d = new Date((r as Record<string, unknown>)[dateField] as string);
    return [{ ...(r as object), [dateField]: Number.isNaN(d.getTime()) ? new Date() : d } as T];
  });
}

export async function readLists(parts: ListPart[], withLastCategory: boolean): Promise<SetupLists> {
  const out: SetupLists = {};
  if (parts.includes('favorites')) out.favorites = toWire(await db.favorites.toArray());
  if (parts.includes('watchlist')) out.watchlist = toWire(await db.watchlist.toArray());
  if (parts.includes('progress')) out.progress = toWire(await db.watchProgress.toArray());
  if (withLastCategory) {
    const last = await getLastCategory();
    if (last) out.lastCategory = last;
  }
  return out;
}

/** Full replace: anything not in `lists` is cleared. */
export async function replaceLists(lists: SetupLists): Promise<void> {
  await db.transaction('rw', db.favorites, db.watchlist, db.watchProgress, db.prefs, async () => {
    await Promise.all([db.favorites.clear(), db.watchlist.clear(), db.watchProgress.clear(), db.prefs.delete('lastCategory')]);
    await db.favorites.bulkPut(revive(lists.favorites, DATE_FIELDS.favorites));
    await db.watchlist.bulkPut(revive(lists.watchlist, DATE_FIELDS.watchlist));
    await db.watchProgress.bulkPut(revive(lists.progress, DATE_FIELDS.progress));
    if (lists.lastCategory) await db.prefs.put({ key: 'lastCategory', value: lists.lastCategory });
  });
}
