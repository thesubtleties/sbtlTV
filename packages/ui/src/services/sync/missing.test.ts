// packages/ui/src/services/sync/missing.test.ts
import { describe, expect, it } from 'vitest';
import type { StoredWatchProgress, StoredWatchlistItem } from '../../db';
import { pickMissing } from './missing';

const rec = (o: Partial<StoredWatchProgress>): StoredWatchProgress => ({ id: 'x', type: 'movie', position: 50, duration: 100, progress: 50, completed: false, updated_at: new Date(1), name: 'N', ...o });
const none = { libraryMovieTmdb: new Set<number>(), libraryMovieStreams: new Set<string>(), librarySeriesTmdb: new Set<number>() };

describe('pickMissing', () => {
  it('a movie record found by stream id or TMDB id is not missing; one with neither is', () => {
    const out = pickMissing({
      ...none, libraryMovieStreams: new Set(['s1']), libraryMovieTmdb: new Set([2]),
      movieRecs: [rec({ id: 'movie_s1', stream_id: 's1', tmdb_id: 1 }), rec({ id: 'movie_x', stream_id: 'gone', tmdb_id: 2 }), rec({ id: 'movie_tmdb_3', tmdb_id: 3, name: 'Three' })],
      seriesHeads: [], watchlist: [],
    });
    expect(out.progress).toEqual([{ key: 'missing-movie-3', from: 'progress', type: 'movie', tmdbId: 3, name: 'Three', pct: 50, progressIds: ['movie_tmdb_3'] }]);
  });
  it('one card per missing movie, and a series the library has is not missing (lens 7)', () => {
    const out = pickMissing({
      ...none, librarySeriesTmdb: new Set([1399]),
      movieRecs: [rec({ id: 'movie_a', stream_id: 'a', tmdb_id: 5 }), rec({ id: 'movie_b', stream_id: 'b', tmdb_id: 5 })],
      seriesHeads: [rec({ id: 'episode_1399_S1_E2', type: 'episode', series_tmdb_id: 1399, name: 'GoT S1E2' })], watchlist: [],
    });
    expect(out.progress.map((m) => m.key)).toEqual(['missing-movie-5']);
  });
  it('records without a TMDB id are never missing (they are orphans, as today)', () => {
    expect(pickMissing({ ...none, movieRecs: [rec({ stream_id: 'gone' })], seriesHeads: [], watchlist: [] }).progress).toEqual([]);
  });
  it('series by series TMDB id; watchlist by TMDB id and type', () => {
    const wl: StoredWatchlistItem[] = [
      { id: 'series_1399', type: 'series', tmdb_id: 1399, name: 'GoT', added: new Date(1) },
      { id: 'movie_7', type: 'movie', tmdb_id: 7, name: 'Have it', added: new Date(1) },
    ];
    const out = pickMissing({
      ...none, libraryMovieTmdb: new Set([7]),
      movieRecs: [], seriesHeads: [rec({ id: 'episode_1399_S1_E2', type: 'episode', series_tmdb_id: 1399, name: 'GoT S1E2' })], watchlist: wl,
    });
    expect(out.progress.map((m) => m.tmdbId)).toEqual([1399]);
    expect(out.watchlist.map((m) => m.tmdbId)).toEqual([1399]);
  });
});
