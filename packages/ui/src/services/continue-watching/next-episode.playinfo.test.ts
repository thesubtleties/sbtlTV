import { describe, it, expect } from 'vitest';
import { buildNextEpisodePlayInfo, buildEpisodePlayInfo } from './next-episode.playinfo';
import type { StoredSeries, StoredEpisode } from '../../db';

const series = { tmdb_id: 1399, series_id: 'S9', source_id: 'src1', name: 'Show', title: 'Show' } as StoredSeries;
// Episodes intentionally have NO source_id (the Xtream adapter omits it) — sourceId must come from the series.
const episodes = [
  { id: 'e1', season_num: 1, episode_num: 1, direct_url: 'u1', title: 'A' },
  { id: 'e2', season_num: 1, episode_num: 2, direct_url: 'u2', title: 'B' },
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
  it('takes sourceId from the series, not the (sourceId-less) episode', () => {
    expect(buildNextEpisodePlayInfo(series, episodes, 1, 1)?.sourceId).toBe('src1');
  });
  it('falls back to series.name when title is absent', () => {
    const nameless = { ...series, title: undefined } as StoredSeries;
    expect(buildNextEpisodePlayInfo(nameless, episodes, 1, 1)?.title).toBe('Show');
  });
});

describe('buildEpisodePlayInfo', () => {
  it('builds VodPlayInfo for a specific episode (sourceId from series, position handled elsewhere)', () => {
    expect(buildEpisodePlayInfo(series, episodes, 1, 2)).toMatchObject({
      url: 'u2', type: 'series', streamId: 'e2', tmdbId: 1399,
      seriesStreamId: 'S9', sourceId: 'src1', seasonNum: 1, episodeNum: 2,
    });
  });
  it('returns null for a missing episode', () => {
    expect(buildEpisodePlayInfo(series, episodes, 9, 9)).toBeNull();
  });
});
