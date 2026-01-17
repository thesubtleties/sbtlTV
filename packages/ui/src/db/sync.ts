import { db, clearSourceData, type SourceMeta, type StoredProgram } from './index';
import { fetchAndParseM3U, XtreamClient } from '@netv/local-adapter';
import type { Source, Channel, Category } from '@netv/core';

export interface SyncResult {
  success: boolean;
  channelCount: number;
  categoryCount: number;
  programCount: number;
  epgUrl?: string;
  error?: string;
}

// EPG freshness threshold (6 hours)
const EPG_STALE_MS = 6 * 60 * 60 * 1000;

// Sync EPG for all channels from a source using XMLTV
async function syncEpgForSource(source: Source, channels: Channel[]): Promise<number> {
  if (!source.username || !source.password) return 0;

  const client = new XtreamClient(
    { baseUrl: source.url, username: source.username, password: source.password },
    source.id
  );

  // Clear old EPG data for this source
  await db.programs.where('source_id').equals(source.id).delete();

  try {
    // Fetch full XMLTV data
    const xmltvPrograms = await client.getXmltvEpg();

    if (xmltvPrograms.length === 0) {
      return 0;
    }

    // Build a map of epg_channel_id -> stream_id for matching
    const channelMap = new Map<string, string>();
    for (const ch of channels) {
      if (ch.epg_channel_id) {
        channelMap.set(ch.epg_channel_id, ch.stream_id);
      }
    }

    // Convert XMLTV programs to stored format
    const storedPrograms: StoredProgram[] = [];

    for (const prog of xmltvPrograms) {
      const streamId = channelMap.get(prog.channel_id);
      if (streamId) {
        storedPrograms.push({
          id: `${streamId}_${prog.start.getTime()}`,
          stream_id: streamId,
          title: prog.title,
          description: prog.description,
          start: prog.start,
          end: prog.stop,
          source_id: source.id,
        });
      }
    }

    // Store in batches
    const BATCH_SIZE = 1000;
    for (let i = 0; i < storedPrograms.length; i += BATCH_SIZE) {
      const batch = storedPrograms.slice(i, i + BATCH_SIZE);
      await db.programs.bulkPut(batch);
    }

    return storedPrograms.length;
  } catch (err) {
    console.error('EPG fetch failed:', err);
    return 0;
  }
}

// Check if EPG needs refresh
export async function isEpgStale(sourceId: string): Promise<boolean> {
  const meta = await db.sourcesMeta.get(sourceId);
  if (!meta?.last_synced) return true;
  return Date.now() - meta.last_synced.getTime() > EPG_STALE_MS;
}

// Sync a single source - fetches data and stores in Dexie
export async function syncSource(source: Source): Promise<SyncResult> {
  try {
    // Clear existing data for this source first
    await clearSourceData(source.id);

    let channels: Channel[] = [];
    let categories: Category[] = [];
    let epgUrl: string | undefined;

    if (source.type === 'm3u') {
      // M3U source - fetch and parse
      const result = await fetchAndParseM3U(source.url, source.id);
      channels = result.channels;
      categories = result.categories;
      epgUrl = result.epgUrl ?? undefined;
    } else if (source.type === 'xtream') {
      // Xtream source - use client
      if (!source.username || !source.password) {
        throw new Error('Xtream source requires username and password');
      }

      const client = new XtreamClient(
        {
          baseUrl: source.url,
          username: source.username,
          password: source.password,
        },
        source.id
      );

      // Test connection first
      const connTest = await client.testConnection();
      if (!connTest.success) {
        throw new Error(connTest.error ?? 'Connection failed');
      }

      // Fetch categories and channels
      categories = await client.getLiveCategories();
      channels = await client.getLiveStreams();

      // Get server info for EPG URL if available
      if (connTest.info?.server_info) {
        const { url, port } = connTest.info.server_info;
        // Xtream typically serves EPG at /xmltv.php
        epgUrl = `${url}:${port}/xmltv.php?username=${source.username}&password=${source.password}`;
      }
    } else {
      throw new Error(`Unsupported source type: ${source.type}`);
    }

    // Store channels and categories in Dexie
    await db.transaction('rw', [db.channels, db.categories, db.sourcesMeta], async () => {
      if (channels.length > 0) {
        await db.channels.bulkPut(channels);
      }
      if (categories.length > 0) {
        await db.categories.bulkPut(categories);
      }

      // Store sync metadata
      const meta: SourceMeta = {
        source_id: source.id,
        epg_url: epgUrl,
        last_synced: new Date(),
        channel_count: channels.length,
        category_count: categories.length,
      };
      await db.sourcesMeta.put(meta);
    });

    // Fetch EPG for Xtream sources
    let programCount = 0;
    if (source.type === 'xtream' && source.username && source.password) {
      programCount = await syncEpgForSource(source, channels);
    }

    return {
      success: true,
      channelCount: channels.length,
      categoryCount: categories.length,
      programCount,
      epgUrl,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    // Store error in metadata
    await db.sourcesMeta.put({
      source_id: source.id,
      last_synced: new Date(),
      channel_count: 0,
      category_count: 0,
      error: errorMsg,
    });

    return {
      success: false,
      channelCount: 0,
      categoryCount: 0,
      programCount: 0,
      error: errorMsg,
    };
  }
}

// Sync all enabled sources
export async function syncAllSources(): Promise<Map<string, SyncResult>> {
  const results = new Map<string, SyncResult>();

  // Get sources from electron storage
  if (!window.storage) {
    console.error('Storage API not available');
    return results;
  }

  const sourcesResult = await window.storage.getSources();
  if (!sourcesResult.data) {
    console.error('Failed to get sources:', sourcesResult.error);
    return results;
  }

  // Sync each enabled source
  for (const source of sourcesResult.data) {
    if (source.enabled) {
      console.log(`Syncing source: ${source.name} (${source.type})`);
      const result = await syncSource(source);
      results.set(source.id, result);
      console.log(`  → ${result.success ? 'OK' : 'FAILED'}: ${result.channelCount} channels, ${result.categoryCount} categories`);
    }
  }

  return results;
}

// Get sync status for all sources
export async function getSyncStatus(): Promise<SourceMeta[]> {
  return db.sourcesMeta.toArray();
}
