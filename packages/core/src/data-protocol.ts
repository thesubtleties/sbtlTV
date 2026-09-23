import type { Channel, Category, Movie, Series, Episode, Source } from './types';

// ---- Tables the data process owns (rebuildable) ----
export type DataTable =
  | 'sources_meta' | 'categories' | 'channels' | 'epg_programs' | 'epg_links'
  | 'vod_categories' | 'vod_movies' | 'vod_series' | 'vod_episodes';

// ---- Rows as the renderer receives them (Dates already converted) ----
export interface SourceMetaRow {
  source_id: string;
  epg_url?: string;
  last_synced?: Date;
  vod_last_synced?: Date;
  channel_count: number;
  category_count: number;
  vod_movie_count?: number;
  vod_series_count?: number;
  error?: string;
}
export interface CategoryRow extends Category { channel_count?: number }
export type ChannelRow = Channel & { tv_archive_days?: number };
export interface ProgramRow {
  id: string;            // `${sourceId}::${epgSource}::${epgChannelId}::${startMs}`
  stream_id: string;     // the stream this row was joined to
  title: string;
  description: string;
  start: Date;
  end: Date;
  source_id: string;
}
export interface MovieRow extends Movie {
  imdb_id?: string; added?: Date; backdrop_path?: string; popularity?: number; match_attempted?: Date;
}
export interface SeriesRow extends Series {
  imdb_id?: string; added?: Date; backdrop_path?: string; popularity?: number; match_attempted?: Date;
}
export interface EpisodeRow extends Episode { series_id: string }
export interface VodCategoryRow { category_id: string; source_id: string; name: string; type: 'movie' | 'series' }

// ---- Requests (renderer -> data process) ----
export type DataRequest =
  | { id: number; type: 'categories'; sourceIds: string[] }                       // [] = all
  | { id: number; type: 'channels'; categoryId: string | null; sourceIds: string[]; sort: 'alphabetical' | 'number' }
  | { id: number; type: 'channelsByIds'; streamIds: string[] }
  | { id: number; type: 'channelCount'; sourceIds: string[] }
  | { id: number; type: 'channelSearch'; query: string; sourceIds: string[]; limit: number }
  | { id: number; type: 'programsInRange'; streamIds: string[]; windowStartMs: number; windowEndMs: number }
  | { id: number; type: 'currentProgram'; streamId: string; nowMs: number }
  | { id: number; type: 'syncStatus' }
  | { id: number; type: 'movies'; by: MovieSelector; sourceIds: string[]; limit?: number }
  | { id: number; type: 'series'; by: SeriesSelector; sourceIds: string[]; limit?: number }
  | { id: number; type: 'episodes'; seriesIds: string[] }
  | { id: number; type: 'vodCategories'; kind: 'movie' | 'series'; sourceIds: string[] }
  | { id: number; type: 'vodCounts'; sourceIds: string[] }
  | { id: number; type: 'syncNow'; sourceId?: string; what: 'channels' | 'vod' | 'all' }
  | { id: number; type: 'syncEpisodes'; seriesId: string }
  | { id: number; type: 'rematchEpg'; sourceId: string }
  | { id: number; type: 'updateVodDetails'; kind: 'movie' | 'series'; itemId: string; fields: VodDetailFields }
  | { id: number; type: 'importPlaylist'; sourceId: string; content: string }   // an M3U file the user picked
  | { id: number; type: 'clearAll' };

// Details the renderer fetched from TMDB on demand; only empty columns are filled.
export interface VodDetailFields { plot?: string; genre?: string; cast?: string; director?: string; backdrop_path?: string }

// 'categories' returns every item in any of the given categories (VodBrowse groups
// same-named categories across sources); 'all' is the whole library, as the browse
// page loads today when no category is selected.
export type MovieSelector =
  | { kind: 'categories'; categoryIds: string[] }
  | { kind: 'all' }
  | { kind: 'tmdbIds'; tmdbIds: number[] }
  | { kind: 'ids'; streamIds: string[] }
  | { kind: 'search'; text: string }
  | { kind: 'popular' };
export type SeriesSelector =
  | { kind: 'categories'; categoryIds: string[] }
  | { kind: 'all' }
  | { kind: 'tmdbIds'; tmdbIds: number[] }
  | { kind: 'ids'; seriesIds: string[] }
  | { kind: 'search'; text: string }
  | { kind: 'popular' };

// ---- Replies ----
export type ReplyFor<R extends DataRequest> =
  R extends { type: 'categories' } ? CategoryRow[] :
  R extends { type: 'channels' | 'channelsByIds' | 'channelSearch' } ? ChannelRow[] :
  R extends { type: 'channelCount' } ? number :
  R extends { type: 'programsInRange' } ? ProgramRow[] :
  R extends { type: 'currentProgram' } ? ProgramRow | null :
  R extends { type: 'syncStatus' } ? SourceMetaRow[] :
  R extends { type: 'movies' } ? MovieRow[] :
  R extends { type: 'series' } ? SeriesRow[] :
  R extends { type: 'episodes' } ? EpisodeRow[] :
  R extends { type: 'vodCategories' } ? VodCategoryRow[] :
  R extends { type: 'vodCounts' } ? { movies: number; series: number } :
  R extends { type: 'syncNow' | 'syncEpisodes' | 'rematchEpg' | 'updateVodDetails' | 'importPlaylist' | 'clearAll' } ? { accepted: true } :
  never;

// A request without its id, one variant at a time (a plain Omit over the union
// would lose the discriminant). Clients take a body and add the id.
export type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
export type DataRequestBody = DistributiveOmit<DataRequest, 'id'>;
export type ReplyForBody<B extends DataRequestBody> = ReplyFor<Extract<DataRequest, { type: B['type'] }>>;

export type DataReply =
  | { id: number; ok: true; data: unknown }
  | { id: number; ok: false; error: string };

// ---- Events (data process -> renderer) ----
export interface SyncProgress {
  sourceId: string;
  stage: 'channels' | 'epg' | 'vod' | 'episodes' | 'tmdb';
  state: 'started' | 'finished' | 'failed';
  message?: string;
  counts?: Record<string, number>;
}
export type DataEvent =
  | { kind: 'changed'; table: DataTable; sourceId: string | null }
  | { kind: 'sync'; progress: SyncProgress }
  | { kind: 'ready' };

// ---- Control (main <-> data process, over parentPort) ----
export interface DataSettings {
  epgRefreshHours: number;
  vodRefreshHours: number;
  allowLanSources: boolean;
  debugLoggingEnabled: boolean;
}
export type ControlMessage =
  | { type: 'init'; dbPath: string; tempDir: string; sources: Source[]; settings: DataSettings }
  | { type: 'sources'; sources: Source[] }
  | { type: 'settings'; settings: DataSettings }
  | { type: 'deleteSource'; sourceId: string }
  | { type: 'renderer-port' }   // a MessagePortMain travels with this message
  | { type: 'shutdown' };
export type ControlReply =
  | { type: 'ready' }
  | { type: 'log'; category: string; message: string }
  | { type: 'sync'; progress: SyncProgress }
  | { type: 'fatal'; error: string };

// ---- Guards ----
export function isDataRequest(value: unknown): value is DataRequest {
  return typeof value === 'object' && value !== null
    && typeof (value as { id?: unknown }).id === 'number'
    && typeof (value as { type?: unknown }).type === 'string';
}
export function isDataEvent(value: unknown): value is DataEvent {
  const k = (value as { kind?: unknown } | null)?.kind;
  return k === 'changed' || k === 'sync' || k === 'ready';
}
