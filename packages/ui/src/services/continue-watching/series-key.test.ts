import { describe, it, expect } from 'vitest';
import { seriesKey, episodeProgressId } from './series-key';

describe('seriesKey', () => {
  it('prefers tmdb id as a bare string (legacy-compatible)', () => {
    expect(seriesKey({ seriesTmdbId: 1399 })).toBe('1399');
  });
  it('falls back to source+series-stream when no tmdb', () => {
    expect(seriesKey({ sourceId: 'src1', seriesStreamId: 'S42' })).toBe('src:src1:S42');
  });
  it('returns null when nothing identifies the series', () => {
    expect(seriesKey({})).toBeNull();
  });
});

describe('episodeProgressId', () => {
  it('matches the legacy TMDB id format exactly', () => {
    // legacy: `episode_${seriesTmdbId}_S${s}_E${e}`
    expect(episodeProgressId('1399', 1, 1)).toBe('episode_1399_S1_E1');
  });
  it('builds a stable id for the non-tmdb fallback key', () => {
    expect(episodeProgressId('src:src1:S42', 2, 5)).toBe('episode_src:src1:S42_S2_E5');
  });
});
