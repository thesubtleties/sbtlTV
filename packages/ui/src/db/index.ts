import Dexie, { type Table } from 'dexie';
import type { Channel, Category } from '@sbtltv/core';

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
  channel_count: number;
  category_count: number;
  error?: string;
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
  }
}

export const db = new SbtltvDatabase();

// Helper to clear all data for a source (before re-sync)
export async function clearSourceData(sourceId: string): Promise<void> {
  await db.transaction('rw', [db.channels, db.categories, db.sourcesMeta], async () => {
    await db.channels.where('source_id').equals(sourceId).delete();
    await db.categories.where('source_id').equals(sourceId).delete();
    await db.sourcesMeta.where('source_id').equals(sourceId).delete();
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
