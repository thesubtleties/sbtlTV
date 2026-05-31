import { describe, it, expect } from 'vitest';
import { buildNextEpisodePlayInfo } from './next-episode.playinfo';
import type { StoredSeries, StoredEpisode } from '../../db';

const series = { tmdb_id: 1399, series_id: 'S9', source_id: 'src1', name: 'Show', title: 'Show' } as StoredSeries;
const episodes = [
  { id: 'e1', season_num: 1, episode_num: 1, direct_url: 'u1', title: 'A', source_id: 'src1' },
  { id: 'e2', season_num: 1, episode_num: 2, direct_url: 'u2', title: 'B', source_id: 'src1' },
] as StoredEpisode[];

describe('buildNextEpisodePlayInfo', () => {
  it('returns the successor episode as VodPlayInfo', () => {
    const info = buildNextEpisodePlayInfo(series, episodes, 1, 1);
    expect(info).toMatchObject({
      url: 'u2', type: 'series', streamId: 'e2', tmdbId: 1399,
      seriesStreamId: 'S9', seasonNum: 1, episodeNum: 2, sourceId: 'src1',
    });
  });
  it('returns null at end of series', () => {
    expect(buildNextEpisodePlayInfo(series, episodes, 1, 2)).toBeNull();
  });
});
