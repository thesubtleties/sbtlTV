import { describe, it, expect } from 'vitest';
import { mergeEpisodes } from './useContinueWatching';

const ep = (id: string, series_id: string, season_num: number, episode_num: number) => ({ id, series_id, season_num, episode_num, title: id, direct_url: '' });

describe('mergeEpisodes', () => {
  it('keeps one episode per season and number, preferring the primary series then the given order', () => {
    const merged = mergeEpisodes('b', ['a', 'b', 'c'], [ep('a1', 'a', 1, 1), ep('b1', 'b', 1, 1), ep('c2', 'c', 1, 2), ep('a2', 'a', 1, 2), ep('x9', 'x', 9, 9)]);
    expect(merged.map((e) => e.id).sort()).toEqual(['a2', 'b1']);
  });
});
