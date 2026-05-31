import type { ProgressRecord, ResumeTarget } from './types';

export interface EpisodeRef { season_num: number; episode_num: number; }

/** Last-played: the record with the greatest updated_at (moves backward on rewatch).
 *  Tie-break on season/episode so equal timestamps are deterministic. */
export function selectActiveEpisode(group: ProgressRecord[]): ProgressRecord {
  return group.reduce((best, r) => {
    if (+r.updated_at !== +best.updated_at) return r.updated_at > best.updated_at ? r : best;
    const rs = r.season_num ?? 0, bs = best.season_num ?? 0;
    if (rs !== bs) return rs > bs ? r : best;
    return (r.episode_num ?? 0) > (best.episode_num ?? 0) ? r : best;
  });
}

/** Next episode strictly after (season, episode) in the real, sorted episode list. */
export function nextEpisode(episodes: EpisodeRef[], season: number, episode: number): EpisodeRef | null {
  const sorted = [...episodes].sort((a, b) => a.season_num - b.season_num || a.episode_num - b.episode_num);
  for (const ep of sorted) {
    if (ep.season_num > season || (ep.season_num === season && ep.episode_num > episode)) {
      return { season_num: ep.season_num, episode_num: ep.episode_num };
    }
  }
  return null;
}

/** Where to resume a series: in-progress active episode, or the next episode if active is done.
 *  Returns null when finished (completed last episode) OR completed-but-no-list (don't lie about resume). */
export function computeResumeTarget(active: ProgressRecord, episodes: EpisodeRef[]): ResumeTarget | null {
  const s = active.season_num, e = active.episode_num;
  if (s == null || e == null) return null; // malformed/legacy episode record — can't compute a target
  if (!active.completed) {
    return { seasonNum: s, episodeNum: e, position: active.position, progressPct: active.progress };
  }
  if (episodes.length === 0) {
    // Completed + no episode list cached → can't compute an honest successor. Hide rather than
    // "resume" the finished episode (getResumePosition returns 0 for completed → would restart at 0).
    return null;
  }
  const next = nextEpisode(episodes, s, e);
  if (!next) return null;
  return { seasonNum: next.season_num, episodeNum: next.episode_num, position: 0, progressPct: 0 };
}
