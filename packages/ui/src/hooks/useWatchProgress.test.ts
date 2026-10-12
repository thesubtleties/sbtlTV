import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db';
import { updateWatchProgress, getResumePosition, getSavedSubtitleDelay, resolveSavedDelay } from './useWatchProgress';

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

describe('subtitle delay with watch progress', () => {
  const movie = { type: 'movie' as const, streamId: 'm-1', tmdbId: 550, position: 600, duration: 7200, sourceId: 's1' };

  it('restores the delay for the same stream and duration', async () => {
    await updateWatchProgress({ ...movie, subDelay: 0.4 });
    expect(await getSavedSubtitleDelay('movie', { streamId: 'm-1', tmdbId: 550 }, 7201)).toBe(0.4);
  });

  it('keeps the delay through later progress saves', async () => {
    await updateWatchProgress({ ...movie, subDelay: 0.4 });
    await updateWatchProgress({ ...movie, position: 900, subDelay: 0.4 });
    const rec = await db.watchProgress.get('movie_m-1');
    expect(rec?.sub_delay).toBe(0.4);
    expect(rec?.position).toBe(900);
  });

  it('ignores a delay saved on another stream', async () => {
    await updateWatchProgress({ ...movie, subDelay: 0.4 });
    // same TMDB movie, different source's copy
    expect(await getSavedSubtitleDelay('movie', { streamId: 'm-2', tmdbId: 550 }, 7200)).toBe(0);
  });

  it('ignores a delay when the duration no longer matches', async () => {
    await updateWatchProgress({ ...movie, subDelay: 0.4 });
    expect(await getSavedSubtitleDelay('movie', { streamId: 'm-1', tmdbId: 550 }, 7300)).toBe(0);
  });

  it('a finished item starts at 0', async () => {
    await updateWatchProgress({ ...movie, position: 7000, subDelay: 0.4 });  // 97% -> completed
    expect(await getSavedSubtitleDelay('movie', { streamId: 'm-1', tmdbId: 550 }, 7200)).toBe(0);
  });

  it('a zero delay is not stored', async () => {
    await updateWatchProgress({ ...movie, subDelay: 0 });
    const rec = await db.watchProgress.get('movie_m-1');
    expect(rec?.sub_delay).toBeUndefined();
  });

  it('resolveSavedDelay needs a record and a stream id', () => {
    expect(resolveSavedDelay(undefined, 'm-1', 100)).toBe(0);
    expect(resolveSavedDelay({ id: 'x', type: 'movie', position: 10, duration: 100, progress: 10, completed: false, updated_at: new Date(), sub_delay: 1, sub_delay_stream_id: 'm-1' }, undefined, 100)).toBe(0);
  });
});
