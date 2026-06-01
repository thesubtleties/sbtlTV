import type { StoredSeries, StoredEpisode } from '../../db';
import type { VodPlayInfo } from '../../types/media';
import { nextEpisode } from './next-episode';

/** Build a VodPlayInfo for a specific (season, episode) from the merged episode list.
 *  Position is NOT set here — handlePlayVod resumes via getResumePosition. Null if not found. */
export function buildEpisodePlayInfo(
  series: StoredSeries, episodes: StoredEpisode[], season: number, episode: number,
): VodPlayInfo | null {
  const ep = episodes.find(e => Number(e.season_num) === Number(season) && Number(e.episode_num) === Number(episode));
  if (!ep) return null;
  return {
    url: ep.direct_url,
    title: series.title || series.name,
    type: 'series',
    episodeInfo: `S${ep.season_num} E${ep.episode_num}${ep.title ? ` · ${ep.title}` : ''}`,
    streamId: ep.id,
    tmdbId: series.tmdb_id,
    seriesStreamId: series.series_id,
    sourceId: series.source_id,
    seasonNum: ep.season_num,
    episodeNum: ep.episode_num,
  };
}

/** Build the VodPlayInfo for the episode AFTER (season, episode). Null if there is no successor. */
export function buildNextEpisodePlayInfo(
  series: StoredSeries, episodes: StoredEpisode[], season: number, episode: number,
): VodPlayInfo | null {
  const next = nextEpisode(episodes.map(e => ({ season_num: e.season_num, episode_num: e.episode_num })), season, episode);
  if (!next) return null;
  return buildEpisodePlayInfo(series, episodes, next.season_num, next.episode_num);
}
