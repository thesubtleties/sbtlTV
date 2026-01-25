import Dexie, { type Table } from 'dexie';
import type { Channel, Category, Movie, Series, Episode } from '@sbtltv/core';

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

class SbtltvDatabase extends Dexie {
  channels!: Table<StoredChannel, string>;
  categories!: Table<StoredCategory, string>;
  sourcesMeta!: Table<SourceMeta, string>;
  prefs!: Table<UserPrefs, string>;
  programs!: Table<StoredProgram, string>;
  vodMovies!: Table<StoredMovie, string>;
  vodSeries!: Table<StoredSeries, string>;
  vodEpisodes!: Table<StoredEpisode, string>;
  vodCategories!: Table<VodCategory, string>;

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

// Helper to get last selected category
export async function getLastCategory(): Promise<string | null> {
  const pref = await db.prefs.get('lastCategory');
  return pref?.value ?? null;
}

// Helper to set last selected category
export async function setLastCategory(categoryId: string): Promise<void> {
  await db.prefs.put({ key: 'lastCategory', value: categoryId });
}
