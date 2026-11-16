// packages/ui/src/services/sync/apply.test.ts
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db';
import { applyRecords } from './apply';

const lookupNone = async () => [];
beforeEach(async () => { await db.watchlist.clear(); await db.watchProgress.clear(); });

describe('applyRecords', () => {
  it('movie progress updates every local copy with that TMDB id, keeping their subtitle fields (Review Focus 2)', async () => {
    const base = { type: 'movie' as const, tmdb_id: 603, position: 10, duration: 8160, progress: 0, completed: false, updated_at: new Date(1_000) };
    await db.watchProgress.bulkPut([{ id: 'movie_a', stream_id: 'a', sub_delay: 2, sub_delay_stream_id: 'a', ...base }, { id: 'movie_b', stream_id: 'b', ...base }]);
    await applyRecords([{ k: 'pm', tmdb: 603, name: 'M', pos: 4000, dur: 8160, done: false, at: 5_000 }], lookupNone);
    const rows = await db.watchProgress.toArray();
    expect(rows.map((r) => r.position)).toEqual([4000, 4000]);
    expect(rows.find((r) => r.id === 'movie_a')?.sub_delay).toBe(2);
  });

  it('no local copy: the library match by TMDB id, else a TMDB-only row', async () => {
    await applyRecords([{ k: 'pm', tmdb: 1, name: 'A', pos: 5, dur: 10, done: false, at: 1 }], async () => [{ stream_id: 'src_7', tmdb_id: 1 }]);
    expect(await db.watchProgress.get('movie_src_7')).toMatchObject({ tmdb_id: 1, stream_id: 'src_7' });
    await applyRecords([{ k: 'pm', tmdb: 2, name: 'B', pos: 5, dur: 10, done: false, at: 1 }], lookupNone);
    expect(await db.watchProgress.get('movie_tmdb_2')).toMatchObject({ tmdb_id: 2, stream_id: undefined });
  });

  it('a local row saved later is not overwritten by an older record', async () => {
    await db.watchProgress.put({ id: 'movie_a', type: 'movie', stream_id: 'a', tmdb_id: 9, position: 99, duration: 100, progress: 99, completed: true, updated_at: new Date(9_000) });
    await applyRecords([{ k: 'pm', tmdb: 9, name: 'x', pos: 1, dur: 100, done: false, at: 5_000 }], lookupNone);
    expect((await db.watchProgress.get('movie_a'))?.position).toBe(99);
  });

  it('episodes by series TMDB id, season and episode; removals delete', async () => {
    await applyRecords([{ k: 'pe', series: 1399, s: 1, e: 3, name: 'GoT', pos: 50, dur: 3000, done: false, at: 10 }], lookupNone);
    expect(await db.watchProgress.get('episode_1399_S1_E3')).toMatchObject({ type: 'episode', series_tmdb_id: 1399, season_num: 1, episode_num: 3, position: 50 });
    await applyRecords([{ k: 'pe', series: 1399, s: 1, e: 3, name: 'GoT', pos: 0, dur: 0, done: false, at: 20, removed: true }], lookupNone);
    expect(await db.watchProgress.get('episode_1399_S1_E3')).toBeUndefined();
  });

  it('watchlist add and remove; a re-add after a removal comes back (Review Focus 1)', async () => {
    await applyRecords([{ k: 'wl', type: 'movie', tmdb: 603, name: 'M', at: 1 }], lookupNone);
    expect(await db.watchlist.get('movie_603')).toBeTruthy();
    await applyRecords([{ k: 'wl', type: 'movie', tmdb: 603, name: 'M', at: 2, removed: true }], lookupNone);
    expect(await db.watchlist.get('movie_603')).toBeUndefined();
    await applyRecords([{ k: 'wl', type: 'movie', tmdb: 603, name: 'M', at: 3 }], lookupNone);
    expect(await db.watchlist.get('movie_603')).toBeTruthy();
  });

  it('a removal never deletes an entry added after it (a computer joining a group with old removals) (I4)', async () => {
    await db.watchlist.put({ id: 'movie_603', type: 'movie', tmdb_id: 603, name: 'M', added: new Date(5_000) });
    await applyRecords([{ k: 'wl', type: 'movie', tmdb: 603, name: 'M', at: 1_000, removed: true }], lookupNone);
    expect(await db.watchlist.get('movie_603')).toBeTruthy();
  });
});

describe('applyRecords: TMDB movie and TV ids are separate (lens 7)', () => {
  it('removing a movie from the watchlist leaves the series with the same TMDB id', async () => {
    await db.watchlist.put({ id: 'series_1399', type: 'series', tmdb_id: 1399, name: 'GoT', added: new Date(1) });
    await applyRecords([{ k: 'wl', type: 'movie', tmdb: 1399, name: 'Some movie', at: 5_000, removed: true }], lookupNone);
    expect(await db.watchlist.get('series_1399')).toBeTruthy();
  });

  it("movie progress never touches a series' episode rows with the same TMDB id, and still finds the movie in the library", async () => {
    await db.watchProgress.put({ id: 'episode_1399_S1_E3', type: 'episode', tmdb_id: 1399, series_tmdb_id: 1399, season_num: 1, episode_num: 3, position: 50, duration: 3000, progress: 2, completed: false, updated_at: new Date(1_000) });
    await applyRecords([{ k: 'pm', tmdb: 1399, name: 'Some movie', pos: 600, dur: 6000, done: false, at: 5_000 }], async () => [{ stream_id: 'src_7', tmdb_id: 1399 }]);
    expect((await db.watchProgress.get('episode_1399_S1_E3'))?.position).toBe(50);
    expect(await db.watchProgress.get('movie_src_7')).toMatchObject({ position: 600, type: 'movie' });
  });
});

describe('applyRecords: a newer local row wins (lens 7)', () => {
  it('an older movie removal leaves progress saved here after it', async () => {
    await db.watchProgress.put({ id: 'movie_a', type: 'movie', stream_id: 'a', tmdb_id: 9, position: 99, duration: 100, progress: 99, completed: false, updated_at: new Date(9_000) });
    await applyRecords([{ k: 'pm', tmdb: 9, name: 'x', pos: 0, dur: 0, done: false, at: 5_000, removed: true }], lookupNone);
    expect(await db.watchProgress.get('movie_a')).toBeTruthy();
  });

  it('an older episode record (or removal) leaves the episode saved here after it', async () => {
    await db.watchProgress.put({ id: 'episode_1399_S1_E3', type: 'episode', tmdb_id: 1399, series_tmdb_id: 1399, season_num: 1, episode_num: 3, position: 2500, duration: 3000, progress: 83, completed: false, updated_at: new Date(9_000) });
    await applyRecords([{ k: 'pe', series: 1399, s: 1, e: 3, name: 'GoT', pos: 10, dur: 3000, done: false, at: 5_000 }], lookupNone);
    expect((await db.watchProgress.get('episode_1399_S1_E3'))?.position).toBe(2500);
    await applyRecords([{ k: 'pe', series: 1399, s: 1, e: 3, name: 'GoT', pos: 0, dur: 0, done: false, at: 6_000, removed: true }], lookupNone);
    expect(await db.watchProgress.get('episode_1399_S1_E3')).toBeTruthy();
  });
});
