import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db';
import { updateWatchProgress, getResumePosition } from './useWatchProgress';

beforeEach(async () => { await db.watchProgress.clear(); });

describe('#68 non-TMDB episode progress', () => {
  it('stores a non-TMDB episode under an EPISODE key (not a movie key)', async () => {
    await updateWatchProgress({
      type: 'episode', streamId: 'ep-9', sourceId: 'src1', seriesStreamId: 'S42',
      seasonNum: 2, episodeNum: 5, position: 700, duration: 2000, name: 'X S2 E5',
    });
    const rec = await db.watchProgress.where('stream_id').equals('ep-9').first();
    expect(rec?.id).toBe('episode_src:src1:S42_S2_E5'); // old code misfiled as 'movie_ep-9'
    expect(rec?.series_stream_id).toBe('S42');
  });

  it('resumes a non-TMDB episode at its saved position', async () => {
    await updateWatchProgress({
      type: 'episode', streamId: 'ep-9', sourceId: 'src1', seriesStreamId: 'S42',
      seasonNum: 2, episodeNum: 5, position: 700, duration: 2000,
    });
    const pos = await getResumePosition('episode', {
      streamId: 'ep-9', sourceId: 'src1', seriesStreamId: 'S42', seasonNum: 2, episodeNum: 5,
    });
    expect(pos).toBe(700);
  });

  it('keeps the legacy TMDB id so existing records still resume', async () => {
    await db.watchProgress.put({
      id: 'episode_1399_S1_E1', type: 'episode', series_tmdb_id: 1399,
      stream_id: 'ep-1', season_num: 1, episode_num: 1,
      position: 300, duration: 2000, progress: 15, completed: false, updated_at: new Date(),
    });
    const pos = await getResumePosition('episode', { seriesTmdbId: 1399, seasonNum: 1, episodeNum: 1, streamId: 'ep-1' });
    expect(pos).toBe(300);
  });
});
