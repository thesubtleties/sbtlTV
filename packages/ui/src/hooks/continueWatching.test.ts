import { describe, it, expect } from 'vitest';
import { mergeEpisodes } from './useContinueWatching';

const ep = (id: string, series_id: string, season_num: number, episode_num: number) => ({ id, series_id, season_num, episode_num, title: id, direct_url: '' });

describe('mergeEpisodes', () => {
  it('keeps one episode per season and number, preferring the primary series then the given order', () => {
    const merged = mergeEpisodes('b', ['a', 'b', 'c'], [ep('a1', 'a', 1, 1), ep('b1', 'b', 1, 1), ep('c2', 'c', 1, 2), ep('a2', 'a', 1, 2), ep('x9', 'x', 9, 9)]);
    expect(merged.map((e) => e.id).sort()).toEqual(['a2', 'b1']);
  });
});

describe('movieForRecord', () => {
  const m = (stream_id: string, tmdb_id?: number) => ({ stream_id, tmdb_id, name: stream_id }) as never;
  it('finds a movie by its stream id first, then by TMDB id (synced from a computer with other providers)', async () => {
    const { movieForRecord } = await import('./useContinueWatching');
    const byStream = new Map([['s1', m('s1', 1)]]);
    const byTmdb = new Map([[2, m('other_9', 2)]]);
    expect(movieForRecord({ stream_id: 's1', tmdb_id: 1 }, byStream, byTmdb)).toMatchObject({ stream_id: 's1' });
    expect(movieForRecord({ stream_id: 'gone', tmdb_id: 2 }, byStream, byTmdb)).toMatchObject({ stream_id: 'other_9' });
    expect(movieForRecord({ tmdb_id: 2 }, byStream, byTmdb)).toMatchObject({ stream_id: 'other_9' });
    expect(movieForRecord({ stream_id: 'gone', tmdb_id: 3 }, byStream, byTmdb)).toBeUndefined();
  });
});

describe('newestPerTitle', () => {
  it('one card per movie when two providers hold the same title: the newest copy (M2)', async () => {
    const { newestPerTitle } = await import('./useContinueWatching');
    const r = (id: string, tmdb_id: number | undefined, t: number) => ({ id, tmdb_id, updated_at: new Date(t) }) as never;
    const out = newestPerTitle([r('movie_b', 603, 9), r('movie_a', 603, 5), r('movie_x', undefined, 7), r('movie_y', undefined, 3)]);
    expect((out as { id: string }[]).map((x) => x.id)).toEqual(['movie_b', 'movie_x', 'movie_y']);
  });
});

describe('seriesNeedingEpisodes', () => {
  it('a finished last episode with no episode list on this computer asks for the list (synced from another computer)', async () => {
    const { seriesNeedingEpisodes } = await import('./useContinueWatching');
    const head = (series_id: string, completed: boolean) => ({ active: { completed }, series: { series_id }, relatedIds: [series_id] }) as never;
    const eps = [{ series_id: 'b', season_num: 1, episode_num: 1 }] as never;
    expect(seriesNeedingEpisodes([head('a', true), head('b', true), head('c', false)], eps)).toEqual(['a']);
  });
});
