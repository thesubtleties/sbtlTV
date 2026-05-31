/** Stable identity for a series across write/read/group.
 *  TMDB id is returned as a BARE string so episode ids stay byte-identical to the legacy
 *  `episode_${tmdbId}_S_E` format (no migration / no data loss). Only the non-TMDB fallback
 *  gets a new key (those episodes had no stable key before — that IS the #68 bug). */
export function seriesKey(opts: {
  seriesTmdbId?: number;
  sourceId?: string;
  seriesStreamId?: string;
}): string | null {
  if (opts.seriesTmdbId != null) return String(opts.seriesTmdbId);
  if (opts.sourceId && opts.seriesStreamId) return `src:${opts.sourceId}:${opts.seriesStreamId}`;
  return null;
}

export function episodeProgressId(key: string, season: number, episode: number): string {
  return `episode_${key}_S${season}_E${episode}`;
}

export function movieProgressId(streamId: string): string {
  return `movie_${streamId}`;
}
