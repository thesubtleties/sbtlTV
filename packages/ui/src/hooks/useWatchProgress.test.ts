import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db';
import { updateWatchProgress, getResumePosition, getSubtitleDelayCandidate } from './useWatchProgress';

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

  it('offers the delay saved on the same stream, with its duration', async () => {
    await updateWatchProgress({ ...movie, subDelay: 0.4 });
    expect(await getSubtitleDelayCandidate('movie', { streamId: 'm-1', tmdbId: 550 })).toEqual({ delay: 0.4, duration: 7200 });
  });

  it('keeps the delay through later progress saves', async () => {
    await updateWatchProgress({ ...movie, subDelay: 0.4 });
    await updateWatchProgress({ ...movie, position: 900, subDelay: 0.4 });
    const rec = await db.watchProgress.get('movie_m-1');
    expect(rec?.sub_delay).toBe(0.4);
    expect(rec?.position).toBe(900);
  });

  it('a zero delay is not stored', async () => {
    await updateWatchProgress({ ...movie, subDelay: 0 });
    const rec = await db.watchProgress.get('movie_m-1');
    expect(rec?.sub_delay).toBeUndefined();
  });

  it('episodes find their delay through the series key', async () => {
    const ep = { type: 'episode' as const, streamId: 'ep-9', sourceId: 'src1', seriesStreamId: 'S42', seasonNum: 2, episodeNum: 5, position: 700, duration: 2000 };
    await updateWatchProgress({ ...ep, subDelay: -0.3 });
    expect(await getSubtitleDelayCandidate('episode', { streamId: 'ep-9', sourceId: 'src1', seriesStreamId: 'S42', seasonNum: 2, episodeNum: 5 }))
      .toEqual({ delay: -0.3, duration: 2000 });
  });
});

describe('subtitle delay survives the next play', () => {
  const movie = { type: 'movie' as const, streamId: 'm-1', tmdbId: 550, position: 600, duration: 7200, sourceId: 's1' };

  it('a save that has not resolved the delay yet keeps the saved one', async () => {
    await updateWatchProgress({ ...movie, subDelay: 0.4 });
    // replay: the first progress save lands before the restore, with no delay decided
    await updateWatchProgress({ ...movie, position: 610 });
    const candidate = await getSubtitleDelayCandidate('movie', { streamId: 'm-1', tmdbId: 550 });
    expect(candidate).toEqual({ delay: 0.4, duration: 7200 });
  });

  it('an explicit 0 clears the saved delay', async () => {
    await updateWatchProgress({ ...movie, subDelay: 0.4 });
    await updateWatchProgress({ ...movie, subDelay: 0 });
    expect(await getSubtitleDelayCandidate('movie', { streamId: 'm-1', tmdbId: 550 })).toBeNull();
  });

  it('prefers this copy\'s record over another copy of the same movie', async () => {
    await updateWatchProgress({ ...movie, streamId: 'm-2', subDelay: 1.0 });
    await updateWatchProgress({ ...movie, subDelay: 0.4 });
    expect(await getSubtitleDelayCandidate('movie', { streamId: 'm-1', tmdbId: 550 })).toEqual({ delay: 0.4, duration: 7200 });
  });

  it('no candidate for a finished item or another copy', async () => {
    await updateWatchProgress({ ...movie, streamId: 'm-2', subDelay: 1.0 });
    expect(await getSubtitleDelayCandidate('movie', { streamId: 'm-1', tmdbId: 550 })).toBeNull();
    await updateWatchProgress({ ...movie, position: 7000, subDelay: 0.4 });
    expect(await getSubtitleDelayCandidate('movie', { streamId: 'm-1', tmdbId: 550 })).toBeNull();
  });
});

describe('SubDL subtitle choice with watch progress', () => {
  const movie = { type: 'movie' as const, streamId: 'm-1', tmdbId: 550, position: 600, duration: 7200, name: 'Fight Club' };

  it('saves the file, its AI flag and speed with the delay, and offers them back', async () => {
    await updateWatchProgress({ ...movie, subDelay: 0.4, subSpeed: 0.95904, subdlId: 'pg/fl', subdlAi: true });
    expect(await getSubtitleDelayCandidate('movie', { streamId: 'm-1', tmdbId: 550 }))
      .toEqual({ delay: 0.4, duration: 7200, speed: 0.95904, subdlId: 'pg/fl', ai: true });
  });

  it('a SubDL file with no timing change is still offered', async () => {
    await updateWatchProgress({ ...movie, subDelay: 0, subSpeed: 1, subdlId: 'pg/fl', subdlAi: false });
    expect(await getSubtitleDelayCandidate('movie', { streamId: 'm-1', tmdbId: 550 }))
      .toEqual({ delay: 0, duration: 7200, subdlId: 'pg/fl' });
  });

  it('a save that has not resolved the subtitle yet keeps the stored choice', async () => {
    await updateWatchProgress({ ...movie, subDelay: 0, subSpeed: 1.02, subdlId: 'pg/fl', subdlAi: false });
    await updateWatchProgress({ ...movie, position: 900 });
    const rec = await db.watchProgress.get('movie_m-1');
    expect([rec?.sub_speed, rec?.sub_subdl_id]).toEqual([1.02, 'pg/fl']);
  });

  it('picking a built-in track again clears the SubDL choice', async () => {
    await updateWatchProgress({ ...movie, subDelay: 0, subdlId: 'pg/fl' });
    await updateWatchProgress({ ...movie, subDelay: 0, subSpeed: 1, subdlId: null });
    expect(await getSubtitleDelayCandidate('movie', { streamId: 'm-1', tmdbId: 550 })).toBeNull();
  });
});
