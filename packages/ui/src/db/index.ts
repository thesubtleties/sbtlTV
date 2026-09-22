import Dexie, { type Table } from 'dexie';
import type { CategoryRow, ChannelRow, ProgramRow, SourceMetaRow, MovieRow, SeriesRow, EpisodeRow, VodCategoryRow } from '@sbtltv/core';

// Channels, categories, programmes and the VOD library live in the data
// process (SQLite) since 0.11.0. These names stay for the many call sites that
// type rows with them; the rows themselves come from `@sbtltv/core`.
export type StoredChannel = ChannelRow;
export type StoredCategory = CategoryRow;
export type SourceMeta = SourceMetaRow;
export type StoredMovie = MovieRow;
export type StoredSeries = SeriesRow;
export type StoredEpisode = EpisodeRow;
export type VodCategory = VodCategoryRow;
export type StoredProgram = ProgramRow;

// User preferences (last selected category, etc.)
export interface UserPrefs {
  key: string;
  value: string;
}

// Favorite item (channels + VOD, survives sync)
export interface StoredFavorite {
  id: string;              // `${type}_${key}` where key is stream_id or tmdb_id
  type: 'channel' | 'movie' | 'series';
  stream_id?: string;      // For channels (source-specific)
  tmdb_id?: number;        // For VOD (cross-source)
  name?: string;           // Display name snapshot
  added: Date;
  sort_order?: number;
}

// Watchlist item (want-to-watch VOD)
export interface StoredWatchlistItem {
  id: string;              // `${type}_${key}`
  type: 'movie' | 'series';
  tmdb_id?: number;
  stream_id?: string;      // Fallback when no tmdb_id
  name: string;
  poster_path?: string;
  added: Date;
}

// Watch progress (position tracking, Trakt-compatible)
export interface StoredWatchProgress {
  id: string;              // `${type}_${stream_id}` or `episode_${series_tmdb_id}_S${season}_E${episode}`
  type: 'movie' | 'episode';
  tmdb_id?: number;
  stream_id?: string;
  series_tmdb_id?: number; // For episodes: the parent series tmdb_id
  series_stream_id?: string; // Series-level stream id; used for seriesKey when no tmdb match
  season_num?: number;
  episode_num?: number;
  position: number;        // Seconds
  duration: number;        // Total duration seconds
  progress: number;        // 0-100%
  completed: boolean;      // true when progress >= 90%
  name?: string;
  updated_at: Date;
  source_id?: string;
}

// Dexie keeps only what the user owns: prefs, favorites, watchlist, watch progress.
class SbtltvDatabase extends Dexie {
  prefs!: Table<UserPrefs, string>;
  favorites!: Table<StoredFavorite, string>;
  watchlist!: Table<StoredWatchlistItem, string>;
  watchProgress!: Table<StoredWatchProgress, string>;

  constructor() {
    super('sbtltv');

    this.version(1).stores({
      // Primary key is stream_id, indexed by source_id and category_ids
      channels: 'stream_id, source_id, *category_ids, name',
      // Primary key is category_id, indexed by source_id
      categories: 'category_id, source_id, category_name',
      // Source sync metadata
      sourcesMeta: 'source_id',
      // Simple key-value for user preferences
      prefs: 'key',
    });

    // Add EPG programs table
    this.version(2).stores({
      channels: 'stream_id, source_id, *category_ids, name',
      categories: 'category_id, source_id, category_name',
      sourcesMeta: 'source_id',
      prefs: 'key',
      programs: 'id, stream_id, source_id, start, end',
    });

    // Add VOD tables for movies and series
    this.version(3).stores({
      channels: 'stream_id, source_id, *category_ids, name',
      categories: 'category_id, source_id, category_name',
      sourcesMeta: 'source_id',
      prefs: 'key',
      programs: 'id, stream_id, source_id, start, end',
      vodMovies: 'stream_id, source_id, *category_ids, name, tmdb_id, added',
      vodSeries: 'series_id, source_id, *category_ids, name, tmdb_id, added',
      vodEpisodes: 'id, series_id, season_num, episode_num',
      vodCategories: 'category_id, source_id, name, type',
    });

    // Add popularity index for local popular content queries
    this.version(4).stores({
      channels: 'stream_id, source_id, *category_ids, name',
      categories: 'category_id, source_id, category_name',
      sourcesMeta: 'source_id',
      prefs: 'key',
      programs: 'id, stream_id, source_id, start, end',
      vodMovies: 'stream_id, source_id, *category_ids, name, tmdb_id, added, popularity',
      vodSeries: 'series_id, source_id, *category_ids, name, tmdb_id, added, popularity',
      vodEpisodes: 'id, series_id, season_num, episode_num',
      vodCategories: 'category_id, source_id, name, type',
    });

    // Add compound index for efficient unmatched item queries
    this.version(5).stores({
      channels: 'stream_id, source_id, *category_ids, name',
      categories: 'category_id, source_id, category_name',
      sourcesMeta: 'source_id',
      prefs: 'key',
      programs: 'id, stream_id, source_id, start, end',
      vodMovies: 'stream_id, source_id, *category_ids, name, tmdb_id, added, popularity, [source_id+tmdb_id]',
      vodSeries: 'series_id, source_id, *category_ids, name, tmdb_id, added, popularity, [source_id+tmdb_id]',
      vodEpisodes: 'id, series_id, season_num, episode_num',
      vodCategories: 'category_id, source_id, name, type',
    });

    // Add compound index for efficient EPG time-range queries
    this.version(6).stores({
      channels: 'stream_id, source_id, *category_ids, name',
      categories: 'category_id, source_id, category_name',
      sourcesMeta: 'source_id',
      prefs: 'key',
      programs: 'id, stream_id, source_id, start, end, [stream_id+start]',
      vodMovies: 'stream_id, source_id, *category_ids, name, tmdb_id, added, popularity, [source_id+tmdb_id]',
      vodSeries: 'series_id, source_id, *category_ids, name, tmdb_id, added, popularity, [source_id+tmdb_id]',
      vodEpisodes: 'id, series_id, season_num, episode_num',
      vodCategories: 'category_id, source_id, name, type',
    });

    // Add channel_num index for channel ordering (Xtream num / M3U tvg-chno)
    this.version(7).stores({
      channels: 'stream_id, source_id, *category_ids, name, channel_num',
      categories: 'category_id, source_id, category_name',
      sourcesMeta: 'source_id',
      prefs: 'key',
      programs: 'id, stream_id, source_id, start, end, [stream_id+start]',
      vodMovies: 'stream_id, source_id, *category_ids, name, tmdb_id, added, popularity, [source_id+tmdb_id]',
      vodSeries: 'series_id, source_id, *category_ids, name, tmdb_id, added, popularity, [source_id+tmdb_id]',
      vodEpisodes: 'id, series_id, season_num, episode_num',
      vodCategories: 'category_id, source_id, name, type',
    });

    // Add favorites, watchlist, watch progress tables + forced resync flag
    this.version(8).stores({
      channels: 'stream_id, source_id, *category_ids, name, channel_num',
      categories: 'category_id, source_id, category_name',
      sourcesMeta: 'source_id',
      prefs: 'key',
      programs: 'id, stream_id, source_id, start, end, [stream_id+start]',
      vodMovies: 'stream_id, source_id, *category_ids, name, tmdb_id, added, popularity, [source_id+tmdb_id]',
      vodSeries: 'series_id, source_id, *category_ids, name, tmdb_id, added, popularity, [source_id+tmdb_id]',
      vodEpisodes: 'id, series_id, season_num, episode_num',
      vodCategories: 'category_id, source_id, name, type',
      favorites: 'id, type, stream_id, tmdb_id, added',
      watchlist: 'id, type, tmdb_id, added',
      watchProgress: 'id, type, tmdb_id, stream_id, updated_at, [type+completed]',
    }).upgrade(async (tx) => {
      // Set forced resync flag so app re-syncs with stable M3U IDs
      await tx.table('prefs').put({ key: 'needs_resync', value: 'true' });
    });

    // Compound PK for vodCategories: [source_id+category_id] prevents silent overwrites
    // when two sources share the same Xtream category_id.
    // Dexie can't change a primary key in-place, so we drop (v9) and recreate (v10).
    this.version(9).stores({
      vodCategories: null, // Drop table — PK change requires delete+recreate
    });

    this.version(10).stores({
      channels: 'stream_id, source_id, *category_ids, name, channel_num',
      categories: 'category_id, source_id, category_name',
      sourcesMeta: 'source_id',
      prefs: 'key',
      programs: 'id, stream_id, source_id, start, end, [stream_id+start]',
      vodMovies: 'stream_id, source_id, *category_ids, name, tmdb_id, added, popularity, [source_id+tmdb_id]',
      vodSeries: 'series_id, source_id, *category_ids, name, tmdb_id, added, popularity, [source_id+tmdb_id]',
      vodEpisodes: 'id, series_id, season_num, episode_num',
      vodCategories: '[source_id+category_id], source_id, category_id, name, type',
      favorites: 'id, type, stream_id, tmdb_id, added',
      watchlist: 'id, type, tmdb_id, added',
      watchProgress: 'id, type, tmdb_id, stream_id, updated_at, [type+completed]',
    }).upgrade(async (tx) => {
      // Trigger resync so VOD categories get re-populated with compound keys
      await tx.table('prefs').put({ key: 'needs_resync', value: 'true' });
    });

    // Add series_tmdb_id index to watchProgress for efficient per-series episode lookups
    this.version(11).stores({
      watchProgress: 'id, type, tmdb_id, stream_id, series_tmdb_id, updated_at, [type+completed]',
    });

    // Add EPG mapping table for external EPG channel matching
    this.version(12).stores({
      epgMappings: 'id, source_id, stream_id, [source_id+epg_source]',
    });

    // Index series_stream_id so non-TMDB series grouping + clearSeries avoid full scans.
    // Additive index ONLY — Dexie builds it in place, existing records preserved (no data loss).
    this.version(13).stores({
      watchProgress: 'id, type, tmdb_id, stream_id, series_tmdb_id, series_stream_id, updated_at, [type+completed]',
    });

    // Index `position` on categories so live categories can be ordered by the
    // provider's original arrangement (Provider sort). Additive index ONLY — Dexie
    // builds it in place, existing records preserved (position stays undefined until a
    // source is next synced). No upgrade callback / no forced resync: backfill for
    // opt-in users happens via auto-resync-on-enable in the settings UI. The index
    // powers the readiness check `db.categories.where('position').aboveOrEqual(0)`.
    this.version(14).stores({
      categories: 'category_id, source_id, category_name, position',
    });

    // 0.11.0: every rebuildable table moved to the data process (SQLite). `null`
    // deletes the store and its rows on upgrade; each source resyncs once into
    // the new file. The user-owned tables above are untouched.
    this.version(15).stores({
      channels: null, categories: null, sourcesMeta: null, programs: null, epgMappings: null,
      vodMovies: null, vodSeries: null, vodEpisodes: null, vodCategories: null,
    });
  }
}

export const db = new SbtltvDatabase();

// Helper to get last selected category
export async function getLastCategory(): Promise<string | null> {
  const pref = await db.prefs.get('lastCategory');
  return pref?.value ?? null;
}

// Helper to set last selected category
export async function setLastCategory(categoryId: string): Promise<void> {
  await db.prefs.put({ key: 'lastCategory', value: categoryId });
}
