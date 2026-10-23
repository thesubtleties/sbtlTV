import { db, getLastCategory } from '../../db';

export type ListPart = 'favorites' | 'watchlist' | 'progress';
export interface SetupLists { favorites?: unknown[]; watchlist?: unknown[]; progress?: unknown[]; lastCategory?: string }

const DATE_FIELDS = { favorites: 'added', watchlist: 'added', progress: 'updated_at' } as const;

function toWire(rows: object[]): unknown[] {
  return rows.map((r) => JSON.parse(JSON.stringify(r)));  // Dates become ISO strings
}

// What a row from a file may hold, per table: a file from someone else must not
// put a value the app trusts (a sub_delay string, a NaN position) into Dexie.
type Kind = 'string' | 'number' | 'boolean';
type Spec = { required: Record<string, Kind | readonly string[]>; optional: Record<string, Kind> };
const SPECS: Record<ListPart, Spec> = {
  favorites: {
    required: { id: 'string', type: ['channel', 'movie', 'series'] },
    optional: { stream_id: 'string', tmdb_id: 'number', name: 'string', sort_order: 'number' },
  },
  watchlist: {
    required: { id: 'string', type: ['movie', 'series'], name: 'string' },
    optional: { tmdb_id: 'number', stream_id: 'string', poster_path: 'string' },
  },
  progress: {
    required: { id: 'string', type: ['movie', 'episode'], position: 'number', duration: 'number', progress: 'number', completed: 'boolean' },
    optional: {
      tmdb_id: 'number', stream_id: 'string', series_tmdb_id: 'number', series_stream_id: 'string', season_num: 'number',
      episode_num: 'number', name: 'string', sub_delay: 'number', sub_delay_stream_id: 'string', source_id: 'string',
      sub_speed: 'number', sub_subdl_id: 'string', sub_subdl_ai: 'boolean',
    },
  },
};

function fits(v: unknown, kind: Kind | readonly string[]): boolean {
  if (Array.isArray(kind)) return typeof v === 'string' && kind.includes(v);
  if (kind === 'number') return typeof v === 'number' && Number.isFinite(v);
  if (kind === 'string') return typeof v === 'string' && v.length <= 2000;
  return typeof v === kind;
}

/** Rows from a file, typed: unknown fields dropped, a bad optional field dropped, a bad required one drops the row; the date revived (now, when unreadable). */
function revive<T>(rows: unknown[] | undefined, part: ListPart, dateField: string): T[] {
  const spec = SPECS[part];
  return (rows ?? []).flatMap((r) => {
    if (!r || typeof r !== 'object') return [];
    const raw = r as Record<string, unknown>;
    const row: Record<string, unknown> = {};
    for (const [k, kind] of Object.entries(spec.required)) {
      if (!fits(raw[k], kind)) return [];
      row[k] = raw[k];
    }
    for (const [k, kind] of Object.entries(spec.optional)) if (fits(raw[k], kind)) row[k] = raw[k];
    const d = new Date(raw[dateField] as string);
    row[dateField] = Number.isNaN(d.getTime()) ? new Date() : d;
    return [row as T];
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
    await db.favorites.bulkPut(revive(lists.favorites, 'favorites', DATE_FIELDS.favorites));
    await db.watchlist.bulkPut(revive(lists.watchlist, 'watchlist', DATE_FIELDS.watchlist));
    await db.watchProgress.bulkPut(revive(lists.progress, 'progress', DATE_FIELDS.progress));
    if (lists.lastCategory) await db.prefs.put({ key: 'lastCategory', value: lists.lastCategory });
  });
}
