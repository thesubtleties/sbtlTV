import Dexie, { type Table } from 'dexie';
import type { Channel, Category, Movie, Series, Episode, ExternalIds } from '@sbtltv/core';

// Extended channel with local metadata
export interface StoredChannel extends Channel {
  // For quick lookups
  source_category_key?: string; // `${source_id}_${category_id}` for compound index
}

// Extended category with channel count
export interface StoredCategory extends Category {
  channel_count?: number;
}

// Source sync metadata
export interface SourceMeta {
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

// VOD Movie with TMDB enrichment
export interface StoredMovie extends Movie {
  tmdb_id?: number;
  imdb_id?: string;
  added?: Date;
  backdrop_path?: string;
  popularity?: number;
  match_attempted?: Date; // When TMDB matching was last attempted (even if no match found)
}

// VOD Series with TMDB enrichment
export interface StoredSeries extends Series {
  tmdb_id?: number;
  imdb_id?: string;
  added?: Date;
  backdrop_path?: string;
  popularity?: number;
  match_attempted?: Date; // When TMDB matching was last attempted (even if no match found)
}

// VOD Episode
export interface StoredEpisode extends Episode {
  series_id: string;
}

// VOD Category (movies or series)
export interface VodCategory {
  category_id: string;
  source_id: string;
  name: string;
  type: 'movie' | 'series';
}

// User preferences (last selected category, etc.)
export interface UserPrefs {
  key: string;
  value: string;
}

// EPG program entry
export interface StoredProgram {
  id: string; // `${stream_id}_${start}` compound key
  stream_id: string;
  title: string;
  description: string;
  start: Date;
  end: Date;
  source_id: string;
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

class SbtltvDatabase extends Dexie {
  channels!: Table<StoredChannel, string>;
  categories!: Table<StoredCategory, string>;
  sourcesMeta!: Table<SourceMeta, string>;
  prefs!: Table<UserPrefs, string>;
  programs!: Table<StoredProgram, string>;
  vodMovies!: Table<StoredMovie, string>;
  vodSeries!: Table<StoredSeries, string>;
  vodEpisodes!: Table<StoredEpisode, string>;
  vodCategories!: Table<VodCategory, [string, string]>;
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
  }
}

export const db = new SbtltvDatabase();

// Helper to clear all data for a source (before re-sync or on delete)
export async function clearSourceData(sourceId: string): Promise<void> {
  await db.transaction('rw', [db.channels, db.categories, db.sourcesMeta, db.programs], async () => {
    await db.channels.where('source_id').equals(sourceId).delete();
    await db.categories.where('source_id').equals(sourceId).delete();
    await db.sourcesMeta.where('source_id').equals(sourceId).delete();
    await db.programs.where('source_id').equals(sourceId).delete();
  });
}

// Helper to clear VOD data for a source
export async function clearVodData(sourceId: string): Promise<void> {
  await db.transaction('rw', [db.vodMovies, db.vodSeries, db.vodEpisodes, db.vodCategories], async () => {
    // Get series IDs BEFORE deleting them (episodes don't have source_id directly)
    const series = await db.vodSeries.where('source_id').equals(sourceId).toArray();
    const seriesIds = series.map(s => s.series_id);

    await db.vodMovies.where('source_id').equals(sourceId).delete();
    await db.vodSeries.where('source_id').equals(sourceId).delete();

    // Delete episodes for all series from this source
    for (const seriesId of seriesIds) {
      await db.vodEpisodes.where('series_id').equals(seriesId).delete();
    }
    await db.vodCategories.where('source_id').equals(sourceId).delete();
  });
}

// Purge orphaned data from deleted sources on startup
export async function purgeOrphanedData(validSourceIds: string[]): Promise<void> {
  const { debugLog } = await import('../utils/debugLog');
  const validSet = new Set(validSourceIds);
  if (validSet.size === 0) return; // Sources not loaded yet

  let liveOrphans = 0;
  let vodOrphans = 0;

  await db.transaction('rw', [
    db.channels, db.categories, db.sourcesMeta, db.programs,
    db.vodMovies, db.vodSeries, db.vodEpisodes, db.vodCategories,
  ], async () => {
    // Find orphaned source_ids in categories
    const allCategories = await db.categories.toArray();
    const orphanedCatSourceIds = new Set(
      allCategories.filter(c => !validSet.has(c.source_id)).map(c => c.source_id)
    );
    liveOrphans = orphanedCatSourceIds.size;

    // Clean up each orphaned source
    for (const orphanId of orphanedCatSourceIds) {
      await db.channels.where('source_id').equals(orphanId).delete();
      await db.categories.where('source_id').equals(orphanId).delete();
      await db.sourcesMeta.where('source_id').equals(orphanId).delete();
      await db.programs.where('source_id').equals(orphanId).delete();
    }

    // VOD side
    const allVodCats = await db.vodCategories.toArray();
    const orphanedVodSourceIds = new Set(
      allVodCats.filter(c => !validSet.has(c.source_id)).map(c => c.source_id)
    );
    vodOrphans = orphanedVodSourceIds.size;

    for (const orphanId of orphanedVodSourceIds) {
      const series = await db.vodSeries.where('source_id').equals(orphanId).toArray();
      for (const s of series) {
        await db.vodEpisodes.where('series_id').equals(s.series_id).delete();
      }
      await db.vodMovies.where('source_id').equals(orphanId).delete();
      await db.vodSeries.where('source_id').equals(orphanId).delete();
      await db.vodCategories.where('source_id').equals(orphanId).delete();
    }
  });

  if (liveOrphans + vodOrphans > 0) {
    debugLog(`Purged orphaned data from ${liveOrphans} live + ${vodOrphans} VOD deleted source(s)`, 'db');
  }
}

// Helper to clear ALL cached data (channels, EPG, VOD, metadata)
// Keeps: prefs (user preferences), electron-store settings, source configs
export async function clearAllCachedData(): Promise<void> {
  await db.transaction('rw', [
    db.channels,
    db.categories,
    db.sourcesMeta,
    db.programs,
    db.vodMovies,
    db.vodSeries,
    db.vodEpisodes,
    db.vodCategories,
  ], async () => {
    await db.channels.clear();
    await db.categories.clear();
    await db.sourcesMeta.clear();
    await db.programs.clear();
    await db.vodMovies.clear();
    await db.vodSeries.clear();
    await db.vodEpisodes.clear();
    await db.vodCategories.clear();
  });
}

// Helper to get last selected category
export async function getLastCategory(): Promise<string | null> {
  const pref = await db.prefs.get('lastCategory');
  return pref?.value ?? null;
}

// Helper to set last selected category
export async function setLastCategory(categoryId: string): Promise<void> {
  await db.prefs.put({ key: 'lastCategory', value: categoryId });
}
