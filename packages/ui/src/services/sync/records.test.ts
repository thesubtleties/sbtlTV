// packages/ui/src/services/sync/records.test.ts
import { describe, expect, it } from 'vitest';
import type { StoredWatchProgress, StoredWatchlistItem } from '../../db';
import { progressRecord, rowsToRecords, watchlistRecord } from './records';

const movie = (o: Partial<StoredWatchProgress>): StoredWatchProgress => ({
  id: 'movie_s1_1', type: 'movie', tmdb_id: 603, stream_id: 's1_1', position: 600, duration: 8160, progress: 7, completed: false,
  name: 'The Matrix', updated_at: new Date(1_000), sub_delay: 2, sub_delay_stream_id: 's1_1', ...o,
});

describe('records from rows', () => {
  it('movie progress keys by TMDB id and leaves per-copy subtitle fields behind', () => {
    expect(progressRecord(movie({}))).toEqual({ k: 'pm', tmdb: 603, name: 'The Matrix', pos: 600, dur: 8160, done: false, at: 1_000 });
  });
  it('episodes key by series TMDB id, season and episode', () => {
    const ep = movie({ id: 'episode_1399_S1_E3', type: 'episode', tmdb_id: 1399, series_tmdb_id: 1399, season_num: 1, episode_num: 3, name: 'GoT S1E3' });
    expect(progressRecord(ep)).toMatchObject({ k: 'pe', series: 1399, s: 1, e: 3 });
  });
  it('rows without TMDB identity do not sync', () => {
    expect(progressRecord(movie({ tmdb_id: undefined }))).toBeNull();
    expect(progressRecord(movie({ type: 'episode', series_tmdb_id: undefined, season_num: 1, episode_num: 1 }))).toBeNull();
  });
  it('a removal is a record with removed set', () => {
    expect(progressRecord(movie({}), true, 5_000)).toMatchObject({ removed: true, at: 5_000 });
    expect(watchlistRecord('series', 1399, 'GoT', 9, true)).toEqual({ k: 'wl', type: 'series', tmdb: 1399, name: 'GoT', at: 9, removed: true });
  });
  it('snapshot: newest row wins when two copies share a TMDB id (Review Focus 2)', () => {
    const a = movie({ id: 'movie_s1_1', position: 100, updated_at: new Date(1_000) });
    const b = movie({ id: 'movie_s2_9', stream_id: 's2_9', position: 900, updated_at: new Date(2_000) });
    const wl: StoredWatchlistItem[] = [{ id: 'movie_603', type: 'movie', tmdb_id: 603, name: 'The Matrix', added: new Date(3) }, { id: 'movie_s9', type: 'movie', stream_id: 's9', name: 'No TMDB', added: new Date(4) }];
    const out = rowsToRecords(wl, [a, b]);
    expect(out.filter((r) => r.k === 'pm')).toEqual([expect.objectContaining({ pos: 900 })]);
    expect(out.filter((r) => r.k === 'wl')).toHaveLength(1);
  });
});
