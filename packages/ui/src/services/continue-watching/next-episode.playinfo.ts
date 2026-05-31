import type { StoredSeries, StoredEpisode } from '../../db';
import type { VodPlayInfo } from '../../types/media';
import { nextEpisode } from './next-episode';

/** Build the VodPlayInfo for the episode after (season, episode). Null if there is no successor. */
export function buildNextEpisodePlayInfo(
  series: StoredSeries, episodes: StoredEpisode[], season: number, episode: number,
): VodPlayInfo | null {
  const next = nextEpisode(episodes.map(e => ({ season_num: e.season_num, episode_num: e.episode_num })), season, episode);
  if (!next) return null;
  const ep = episodes.find(e => e.season_num === next.season_num && e.episode_num === next.episode_num);
  if (!ep) return null;
  return {
    url: ep.direct_url,
    title: series.title || series.name,
    type: 'series',
    episodeInfo: `S${ep.season_num} E${ep.episode_num}${ep.title ? ` · ${ep.title}` : ''}`,
    streamId: ep.id,
    tmdbId: series.tmdb_id,
    seriesStreamId: series.series_id,
    sourceId: ep.source_id,
    seasonNum: ep.season_num,
    episodeNum: ep.episode_num,
  };
}
