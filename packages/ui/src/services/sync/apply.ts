// packages/ui/src/services/sync/apply.ts
/**
 * Records from the user's other computers, written into this computer's lists. Straight to Dexie:
 * nothing here is reported back to sync. A local row saved later than a record is left alone.
 */
import type { SyncRecord } from '@sbtltv/core';
import { db, type StoredWatchProgress } from '../../db';
import { data } from '../../data/client';
import { episodeProgressId, movieProgressId } from '../continue-watching/series-key';

type Lookup = (tmdbIds: number[]) => Promise<{ stream_id: string; tmdb_id?: number }[]>;
const libraryLookup: Lookup = (tmdbIds) => data.query({ type: 'movies', by: { kind: 'tmdbIds', tmdbIds }, sourceIds: [] });

const pct = (pos: number, dur: number) => (dur > 0 ? Math.round((pos / dur) * 100) : 0);

export async function applyRecords(records: SyncRecord[], lookup: Lookup = libraryLookup): Promise<void> {
  const movieNeeds = records.filter((r) => r.k === 'pm' && !r.removed).map((r) => (r as Extract<SyncRecord, { k: 'pm' }>).tmdb);
  const library = new Map<number, string>();
  if (movieNeeds.length) {
    const have = new Set((await db.watchProgress.where('tmdb_id').anyOf(movieNeeds).toArray()).filter((r) => r.type === 'movie').map((r) => r.tmdb_id));
    const missing = movieNeeds.filter((t) => !have.has(t));
    if (missing.length) for (const m of await lookup(missing)) if (m.tmdb_id && !library.has(m.tmdb_id)) library.set(m.tmdb_id, m.stream_id);
  }
  await db.transaction('rw', db.watchlist, db.watchProgress, async () => {
    for (const r of records) {
      const when = new Date(r.at);
      if (r.k === 'wl') {
        const id = `${r.type}_${r.tmdb}`;
        if (r.removed) {
          const ids = (await db.watchlist.where('tmdb_id').equals(r.tmdb).toArray()).filter((w) => w.type === r.type).map((w) => w.id);
          await db.watchlist.bulkDelete([id, ...ids]);
        } else if (!(await db.watchlist.get(id))) {
          await db.watchlist.put({ id, type: r.type, tmdb_id: r.tmdb, name: r.name, added: when });
        }
      } else if (r.k === 'pm') {
        const rows = (await db.watchProgress.where('tmdb_id').equals(r.tmdb).toArray()).filter((p) => p.type === 'movie');
        if (r.removed) { await db.watchProgress.bulkDelete(rows.filter((p) => +p.updated_at <= r.at).map((p) => p.id)); continue; }
        const fields = { position: r.pos, duration: r.dur, progress: pct(r.pos, r.dur), completed: r.done, updated_at: when };
        if (rows.length) {
          for (const p of rows) if (+p.updated_at < r.at) await db.watchProgress.update(p.id, fields);
        } else {
          const streamId = library.get(r.tmdb);
          const row: StoredWatchProgress = { id: streamId ? movieProgressId(streamId) : `movie_tmdb_${r.tmdb}`, type: 'movie', tmdb_id: r.tmdb, stream_id: streamId, name: r.name, ...fields };
          await db.watchProgress.put(row);
        }
      } else if (r.k === 'pe') {
        const id = episodeProgressId(String(r.series), r.s, r.e);
        const prev = await db.watchProgress.get(id);
        if (prev && +prev.updated_at >= r.at) continue;
        if (r.removed) { await db.watchProgress.delete(id); continue; }
        const fields = { position: r.pos, duration: r.dur, progress: pct(r.pos, r.dur), completed: r.done, updated_at: when };
        if (prev) await db.watchProgress.update(id, fields);
        else await db.watchProgress.put({ id, type: 'episode', tmdb_id: r.series, series_tmdb_id: r.series, season_num: r.s, episode_num: r.e, name: r.name, ...fields });
      }
    }
  });
}
