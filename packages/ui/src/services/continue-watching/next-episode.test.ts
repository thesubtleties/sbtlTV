import { describe, it, expect } from 'vitest';
import { selectActiveEpisode, nextEpisode, computeResumeTarget } from './next-episode';
import type { ProgressRecord } from './types';

const r = (o: Partial<ProgressRecord>): ProgressRecord => ({
  id: 'x', type: 'episode', position: 100, duration: 1000, progress: 10,
  completed: false, updated_at: new Date(0), season_num: 1, episode_num: 1, ...o,
});
const eps = [
  { season_num: 1, episode_num: 1 }, { season_num: 1, episode_num: 2 },
  { season_num: 1, episode_num: 3 }, { season_num: 2, episode_num: 1 },
];

describe('selectActiveEpisode', () => {
  it('returns the most recently updated (last-played, even backwards)', () => {
    const a = selectActiveEpisode([
      r({ season_num: 2, episode_num: 1, updated_at: new Date(10) }),
      r({ season_num: 1, episode_num: 1, updated_at: new Date(50) }), // rewatched earlier ep later
    ]);
    expect(a.season_num).toBe(1); expect(a.episode_num).toBe(1);
  });
});

describe('nextEpisode', () => {
  it('advances within a season, skipping gaps', () => {
    expect(nextEpisode(eps, 1, 1)).toEqual({ season_num: 1, episode_num: 2 });
  });
  it('rolls over to the next season', () => {
    expect(nextEpisode(eps, 1, 3)).toEqual({ season_num: 2, episode_num: 1 });
  });
  it('returns null at the end of the series', () => {
    expect(nextEpisode(eps, 2, 1)).toBeNull();
  });
});

describe('computeResumeTarget', () => {
  it('resumes an in-progress active episode at its position', () => {
    const t = computeResumeTarget(r({ season_num: 1, episode_num: 2, completed: false, position: 420, progress: 42 }), eps);
    expect(t).toEqual({ seasonNum: 1, episodeNum: 2, position: 420, progressPct: 42 });
  });
  it('advances to the next episode at 0 when active is completed', () => {
    const t = computeResumeTarget(r({ season_num: 1, episode_num: 2, completed: true, progress: 95 }), eps);
    expect(t).toEqual({ seasonNum: 1, episodeNum: 3, position: 0, progressPct: 0 });
  });
  it('returns null when the completed active episode is the last', () => {
    expect(computeResumeTarget(r({ season_num: 2, episode_num: 1, completed: true }), eps)).toBeNull();
  });
  it('resumes an IN-PROGRESS active even when the episode list is unavailable', () => {
    const t = computeResumeTarget(r({ season_num: 1, episode_num: 2, completed: false, position: 900, progress: 45 }), []);
    expect(t).toEqual({ seasonNum: 1, episodeNum: 2, position: 900, progressPct: 45 });
  });
  it('HIDES a completed series when the episode list is unavailable (no honest successor)', () => {
    expect(computeResumeTarget(r({ season_num: 1, episode_num: 2, completed: true, position: 900, progress: 95 }), [])).toBeNull();
  });
});
