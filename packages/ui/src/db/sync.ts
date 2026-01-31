import { db, clearSourceData, clearVodData, type SourceMeta, type StoredProgram, type StoredMovie, type StoredSeries, type StoredEpisode, type VodCategory } from './index';
import { fetchAndParseM3U, XtreamClient } from '@sbtltv/local-adapter';
import type { Source, Channel, Category, Movie, Series } from '@sbtltv/core';
import { getEnrichedMovieExports, getEnrichedTvExports, findBestMatch, extractMatchParams } from '../services/tmdb-exports';
import { useUIStore } from '../stores/uiStore';

// Debug logging helper - logs to console and optionally to debug file
function debugLog(message: string, category = 'sync'): void {
  const logMsg = `[${category}] ${message}`;
  console.log(logMsg);
  // Also send to main process debug log if available
  if (window.debug?.logFromRenderer) {
    window.debug.logFromRenderer(logMsg).catch(() => {});
  }
}

export interface SyncResult {
  success: boolean;
  channelCount: number;
  categoryCount: number;
  programCount: number;
  epgUrl?: string;
  error?: string;
}

export interface VodSyncResult {
  success: boolean;
  movieCount: number;
  seriesCount: number;
  movieCategoryCount: number;
  seriesCategoryCount: number;
  error?: string;
}

// Default freshness thresholds (can be overridden by user settings)
const DEFAULT_EPG_STALE_HOURS = 6;
const DEFAULT_VOD_STALE_HOURS = 24;

// Track deleted sources to prevent sync from writing results after deletion
// This prevents the race condition where sync writes error AFTER clearSourceData runs
const deletedSourceIds = new Set<string>();

export function markSourceDeleted(sourceId: string) {
  deletedSourceIds.add(sourceId);
  // Clean up after 30 seconds (sync should be done by then)
  setTimeout(() => deletedSourceIds.delete(sourceId), 30000);
}

function isSourceDeleted(sourceId: string): boolean {
  return deletedSourceIds.has(sourceId);
}

// Reference counter for concurrent TMDB matching operations
// Prevents race condition where Source A finishing sets tmdbMatching=false
// while Source B is still running
let tmdbMatchingCount = 0;

function startTmdbMatching() {
  tmdbMatchingCount++;
  if (tmdbMatchingCount === 1) {
    useUIStore.getState().setTmdbMatching(true);
  }
}

function endTmdbMatching() {
  tmdbMatchingCount = Math.max(0, tmdbMatchingCount - 1);
  if (tmdbMatchingCount === 0) {
    useUIStore.getState().setTmdbMatching(false);
  }
}

// Sync EPG for all channels from a source using XMLTV
async function syncEpgForSource(source: Source, channels: Channel[]): Promise<number> {
  if (!source.username || !source.password) return 0;

  debugLog(`Starting EPG sync for source: ${source.name || source.id}`, 'epg');

  const client = new XtreamClient(
    { baseUrl: source.url, username: source.username, password: source.password },
    source.id
  );

  try {
    // Fetch full XMLTV data FIRST (don't delete old data until we have new)
    debugLog('Fetching XMLTV data...', 'epg');
    const xmltvPrograms = await client.getXmltvEpg();
    debugLog(`Received ${xmltvPrograms.length} programs from XMLTV`, 'epg');

    if (xmltvPrograms.length === 0) {
      debugLog('No programs found in XMLTV, keeping existing data', 'epg');
      return 0;
    }

    // Build a map of epg_channel_id -> stream_id for matching
    const channelMap = new Map<string, string>();
    let channelsWithEpgId = 0;
    for (const ch of channels) {
      if (ch.epg_channel_id) {
        channelMap.set(ch.epg_channel_id, ch.stream_id);
        channelsWithEpgId++;
      }
    }
    debugLog(`${channelsWithEpgId}/${channels.length} channels have epg_channel_id`, 'epg');

    // Convert XMLTV programs to stored format
    const storedPrograms: StoredProgram[] = [];
    const unmatchedChannels = new Set<string>();

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
      } else {
        unmatchedChannels.add(prog.channel_id);
      }
    }

    debugLog(`Matched ${storedPrograms.length}/${xmltvPrograms.length} programs (${unmatchedChannels.size} unmatched EPG channels)`, 'epg');

    // SAFETY: Only clear old data if we have new data to replace it
    if (storedPrograms.length === 0) {
      debugLog('WARNING: No programs matched! Keeping existing EPG data to avoid data loss', 'epg');
      return 0;
    }

    // Clear old and store new
    debugLog('Clearing old EPG data and storing new...', 'epg');
    await db.programs.where('source_id').equals(source.id).delete();

    // Store in batches
    const BATCH_SIZE = 1000;
    for (let i = 0; i < storedPrograms.length; i += BATCH_SIZE) {
      const batch = storedPrograms.slice(i, i + BATCH_SIZE);
      await db.programs.bulkPut(batch);
    }

    debugLog(`EPG sync complete: ${storedPrograms.length} programs stored`, 'epg');
    return storedPrograms.length;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    debugLog(`EPG fetch FAILED: ${errMsg}`, 'epg');
    debugLog('Keeping existing EPG data', 'epg');
    return 0;
  }
}

// Check if EPG needs refresh
// refreshHours: 0 = manual only (never auto-stale), default 6 hours
export async function isEpgStale(sourceId: string, refreshHours: number = DEFAULT_EPG_STALE_HOURS): Promise<boolean> {
  // 0 means manual-only, never consider stale for auto-refresh
  if (refreshHours === 0) return false;

  const meta = await db.sourcesMeta.get(sourceId);
  if (!meta?.last_synced) return true;

  const staleMs = refreshHours * 60 * 60 * 1000;
  return Date.now() - meta.last_synced.getTime() > staleMs;
}

// Check if VOD needs refresh
// refreshHours: 0 = manual only (never auto-stale), default 24 hours
export async function isVodStale(sourceId: string, refreshHours: number = DEFAULT_VOD_STALE_HOURS): Promise<boolean> {
  // 0 means manual-only, never consider stale for auto-refresh
  if (refreshHours === 0) return false;

  const meta = await db.sourcesMeta.get(sourceId);
  if (!meta?.vod_last_synced) return true;

  const staleMs = refreshHours * 60 * 60 * 1000;
  return Date.now() - meta.vod_last_synced.getTime() > staleMs;
}

// Sync a single source - fetches data and stores in Dexie
export async function syncSource(source: Source): Promise<SyncResult> {
  debugLog(`Starting sync for source: ${source.name} (${source.type})`, 'sync');
  try {
    // Clear existing data for this source first
    debugLog(`Clearing existing data for source: ${source.id}`, 'sync');
    await clearSourceData(source.id);

    let channels: Channel[] = [];
    let categories: Category[] = [];
    let epgUrl: string | undefined;

    if (source.type === 'm3u') {
      // M3U source - fetch and parse
      debugLog(`Fetching M3U from: ${source.url}`, 'sync');
      const result = await fetchAndParseM3U(source.url, source.id);
      channels = result.channels;
      categories = result.categories;
      epgUrl = result.epgUrl ?? undefined;
      debugLog(`M3U parsed: ${channels.length} channels, ${categories.length} categories`, 'sync');
    } else if (source.type === 'xtream') {
      // Xtream source - use client
      if (!source.username || !source.password) {
        throw new Error('Xtream source requires username and password');
      }

      debugLog(`Creating Xtream client for: ${source.url}`, 'sync');
      const client = new XtreamClient(
        {
          baseUrl: source.url,
          username: source.username,
          password: source.password,
        },
        source.id
      );

      // Test connection first
      debugLog('Testing Xtream connection...', 'sync');
      const connTest = await client.testConnection();
      if (!connTest.success) {
        debugLog(`Connection test failed: ${connTest.error}`, 'sync');
        throw new Error(connTest.error ?? 'Connection failed');
      }
      debugLog('Connection test passed', 'sync');

      // Fetch categories and channels
      debugLog('Fetching live categories...', 'sync');
      categories = await client.getLiveCategories();
      debugLog(`Got ${categories.length} categories`, 'sync');

      debugLog('Fetching live streams...', 'sync');
      channels = await client.getLiveStreams();
      debugLog(`Got ${channels.length} channels`, 'sync');

      // Get server info for EPG URL if available
      if (connTest.info?.server_info) {
        const { url, port } = connTest.info.server_info;
        // Xtream typically serves EPG at /xmltv.php
        epgUrl = `${url}:${port}/xmltv.php?username=${source.username}&password=${source.password}`;
      }
    } else {
      throw new Error(`Unsupported source type: ${source.type}`);
    }

    // Check if source was deleted during sync
    if (isSourceDeleted(source.id)) {
      debugLog(`Source ${source.id} was deleted during sync, skipping write`, 'sync');
      return { success: false, channelCount: 0, categoryCount: 0, programCount: 0, error: 'Source deleted' };
    }

    // Store channels and categories in Dexie
    debugLog(`Storing ${channels.length} channels and ${categories.length} categories in DB...`, 'sync');
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
    debugLog('Channels and categories stored successfully', 'sync');

    // Fetch EPG if enabled
    let programCount = 0;
    const shouldLoadEpg = source.auto_load_epg ?? (source.type === 'xtream');

    if (shouldLoadEpg && source.type === 'xtream' && source.username && source.password) {
      // Xtream: use built-in EPG endpoint (or override if provided)
      debugLog('Syncing EPG for Xtream source...', 'epg');
      programCount = await syncEpgForSource(source, channels);
      debugLog(`EPG sync complete: ${programCount} programs`, 'epg');
    } else if (shouldLoadEpg && epgUrl) {
      // M3U with EPG URL: fetch XMLTV from the EPG URL
      // TODO: Implement XMLTV fetch for M3U sources
      debugLog(`M3U EPG URL detected but not implemented: ${epgUrl}`, 'epg');
    }

    // If user provided a manual EPG URL override, use that instead
    if (source.epg_url && !shouldLoadEpg) {
      // TODO: Implement manual XMLTV fetch
      debugLog(`Manual EPG URL override not implemented: ${source.epg_url}`, 'epg');
    }

    debugLog(`Sync complete for ${source.name}: ${channels.length} channels, ${categories.length} categories, ${programCount} programs`, 'sync');
    return {
      success: true,
      channelCount: channels.length,
      categoryCount: categories.length,
      programCount,
      epgUrl,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : '';
    debugLog(`Sync FAILED for ${source.name}: ${errorMsg}`, 'sync');
    debugLog(`Stack trace: ${errorStack}`, 'sync');

    // Don't write error if source was deleted during sync
    if (!isSourceDeleted(source.id)) {
      try {
        await db.sourcesMeta.put({
          source_id: source.id,
          last_synced: new Date(),
          channel_count: 0,
          category_count: 0,
          error: errorMsg,
        });
      } catch (dbError) {
        debugLog(`Failed to write error to sourcesMeta: ${dbError}`, 'sync');
      }
    } else {
      debugLog(`Source ${source.id} was deleted during sync, skipping error write`, 'sync');
    }

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
  debugLog('Starting syncAllSources...', 'sync');
  const results = new Map<string, SyncResult>();

  // Get sources from electron storage
  if (!window.storage) {
    debugLog('ERROR: Storage API not available', 'sync');
    throw new Error('Storage API not available');
  }

  debugLog('Fetching sources from storage...', 'sync');
  const sourcesResult = await window.storage.getSources();
  if (!sourcesResult.data) {
    debugLog(`ERROR: Failed to get sources: ${sourcesResult.error}`, 'sync');
    throw new Error(sourcesResult.error || 'Failed to get sources');
  }
  debugLog(`Found ${sourcesResult.data.length} sources`, 'sync');

  // Sync each enabled source
  const enabledSources = sourcesResult.data.filter(s => s.enabled);
  debugLog(`${enabledSources.length} sources enabled for sync`, 'sync');

  for (const source of enabledSources) {
    debugLog(`Syncing source: ${source.name} (${source.type})`, 'sync');
    const result = await syncSource(source);
    results.set(source.id, result);
    debugLog(`Source ${source.name}: ${result.success ? 'OK' : 'FAILED'} - ${result.channelCount} channels, ${result.categoryCount} categories`, 'sync');
  }

  debugLog('syncAllSources complete', 'sync');
  return results;
}

// Get sync status for all sources
export async function getSyncStatus(): Promise<SourceMeta[]> {
  return db.sourcesMeta.toArray();
}

// ===========================================================================
// VOD Sync Functions
// ===========================================================================

// Sync VOD movies for a single Xtream source
// Uses safe update pattern: fetch new data first, only update if successful
export async function syncVodMovies(source: Source): Promise<{ count: number; categoryCount: number; skipped?: boolean }> {
  if (source.type !== 'xtream' || !source.username || !source.password) {
    return { count: 0, categoryCount: 0 };
  }

  const client = new XtreamClient(
    { baseUrl: source.url, username: source.username, password: source.password },
    source.id
  );

  // Fetch categories and movies FIRST (before any deletes)
  let categories;
  let movies;
  try {
    categories = await client.getVodCategories();
    movies = await client.getVodStreams();
  } catch (err) {
    console.warn('[VOD Movies] Fetch failed, keeping existing data:', err);
    return { count: 0, categoryCount: 0, skipped: true };
  }

  // Check if fetch returned empty when we have existing data
  const existingCount = await db.vodMovies.where('source_id').equals(source.id).count();
  if (movies.length === 0 && existingCount > 0) {
    console.warn('[VOD Movies] Fetch returned empty but we have existing data, keeping it');
    return { count: existingCount, categoryCount: 0, skipped: true };
  }

  // Convert categories to VodCategory format
  const vodCategories: VodCategory[] = categories.map(cat => ({
    category_id: cat.category_id,
    source_id: source.id,
    name: cat.category_name,
    type: 'movie' as const,
  }));

  // Get existing movies to preserve tmdb_id and other enrichments
  const existingMovies = await db.vodMovies.where('source_id').equals(source.id).toArray();
  const existingMap = new Map(existingMovies.map(m => [m.stream_id, m]));

  // Convert movies to StoredMovie format, preserving existing enrichments
  const storedMovies: StoredMovie[] = movies.map(movie => {
    const existing = existingMap.get(movie.stream_id);
    return {
      ...movie,
      // Preserve existing enrichments if present
      tmdb_id: existing?.tmdb_id,
      imdb_id: existing?.imdb_id,
      backdrop_path: existing?.backdrop_path,
      popularity: existing?.popularity,
      added: existing?.added ?? new Date(),
    };
  });

  // Store in batches - use bulkPut to upsert (no delete needed)
  const BATCH_SIZE = 500;

  await db.transaction('rw', [db.vodMovies, db.vodCategories], async () => {
    // Replace categories atomically (delete old, insert new)
    await db.vodCategories.where('source_id').equals(source.id).filter(c => c.type === 'movie').delete();
    if (vodCategories.length > 0) {
      await db.vodCategories.bulkPut(vodCategories);
    }

    // Upsert movies in batches
    for (let i = 0; i < storedMovies.length; i += BATCH_SIZE) {
      const batch = storedMovies.slice(i, i + BATCH_SIZE);
      await db.vodMovies.bulkPut(batch);
    }

    // Remove movies that no longer exist in source (optional cleanup)
    const newIds = new Set(movies.map(m => m.stream_id));
    const toRemove = existingMovies.filter(m => !newIds.has(m.stream_id)).map(m => m.stream_id);
    if (toRemove.length > 0) {
      await db.vodMovies.bulkDelete(toRemove);
      console.log(`[VOD Movies] Removed ${toRemove.length} movies no longer in source`);
    }
  });

  return { count: storedMovies.length, categoryCount: vodCategories.length };
}

// Sync VOD series for a single Xtream source
// Uses safe update pattern: fetch new data first, only update if successful
export async function syncVodSeries(source: Source): Promise<{ count: number; categoryCount: number; skipped?: boolean }> {
  if (source.type !== 'xtream' || !source.username || !source.password) {
    return { count: 0, categoryCount: 0 };
  }

  const client = new XtreamClient(
    { baseUrl: source.url, username: source.username, password: source.password },
    source.id
  );

  // Fetch categories and series FIRST (before any deletes)
  let categories;
  let series;
  try {
    categories = await client.getSeriesCategories();
    series = await client.getSeries();
  } catch (err) {
    console.warn('[VOD Series] Fetch failed, keeping existing data:', err);
    return { count: 0, categoryCount: 0, skipped: true };
  }

  // Check if fetch returned empty when we have existing data
  const existingCount = await db.vodSeries.where('source_id').equals(source.id).count();
  if (series.length === 0 && existingCount > 0) {
    console.warn('[VOD Series] Fetch returned empty but we have existing data, keeping it');
    return { count: existingCount, categoryCount: 0, skipped: true };
  }

  // Convert categories to VodCategory format
  const vodCategories: VodCategory[] = categories.map(cat => ({
    category_id: cat.category_id,
    source_id: source.id,
    name: cat.category_name,
    type: 'series' as const,
  }));

  // Get existing series to preserve tmdb_id and other enrichments
  const existingSeries = await db.vodSeries.where('source_id').equals(source.id).toArray();
  const existingMap = new Map(existingSeries.map(s => [s.series_id, s]));

  // Convert series to StoredSeries format, preserving existing enrichments
  const storedSeries: StoredSeries[] = series.map(s => {
    const existing = existingMap.get(s.series_id);
    return {
      ...s,
      // Preserve existing enrichments if present
      tmdb_id: existing?.tmdb_id,
      imdb_id: existing?.imdb_id,
      backdrop_path: existing?.backdrop_path,
      popularity: existing?.popularity,
      added: existing?.added ?? new Date(),
    };
  });

  // Store in batches - use bulkPut to upsert (no delete needed)
  const BATCH_SIZE = 500;

  await db.transaction('rw', [db.vodSeries, db.vodCategories, db.vodEpisodes], async () => {
    // Replace categories atomically (delete old, insert new)
    await db.vodCategories.where('source_id').equals(source.id).filter(c => c.type === 'series').delete();
    if (vodCategories.length > 0) {
      await db.vodCategories.bulkPut(vodCategories);
    }

    // Upsert series in batches
    for (let i = 0; i < storedSeries.length; i += BATCH_SIZE) {
      const batch = storedSeries.slice(i, i + BATCH_SIZE);
      await db.vodSeries.bulkPut(batch);
    }

    // Remove series that no longer exist in source (and their episodes)
    const newIds = new Set(series.map(s => s.series_id));
    const toRemove = existingSeries.filter(s => !newIds.has(s.series_id)).map(s => s.series_id);
    if (toRemove.length > 0) {
      // Delete orphaned episodes first (they reference series_id)
      await db.vodEpisodes.where('series_id').anyOf(toRemove).delete();
      await db.vodSeries.bulkDelete(toRemove);
      console.log(`[VOD Series] Removed ${toRemove.length} series (and their episodes) no longer in source`);
    }
  });

  return { count: storedSeries.length, categoryCount: vodCategories.length };
}

// Sync episodes for a specific series (on-demand when user views series details)
export async function syncSeriesEpisodes(source: Source, seriesId: string): Promise<number> {
  if (source.type !== 'xtream' || !source.username || !source.password) {
    return 0;
  }

  const client = new XtreamClient(
    { baseUrl: source.url, username: source.username, password: source.password },
    source.id
  );

  const seasons = await client.getSeriesInfo(seriesId);

  // Flatten episodes from all seasons
  const storedEpisodes: StoredEpisode[] = [];
  for (const season of seasons) {
    for (const ep of season.episodes) {
      storedEpisodes.push({
        ...ep,
        series_id: seriesId,
      });
    }
  }

  // Store episodes
  await db.transaction('rw', [db.vodEpisodes], async () => {
    // Clear existing episodes for this series
    await db.vodEpisodes.where('series_id').equals(seriesId).delete();

    if (storedEpisodes.length > 0) {
      await db.vodEpisodes.bulkPut(storedEpisodes);
    }
  });

  return storedEpisodes.length;
}

// Match movies against TMDB exports (no API calls!)
// Uses enriched data with year info for more accurate matching
// Only matches items that haven't been attempted yet (incremental)
async function matchMoviesWithTmdb(sourceId: string): Promise<number> {
  try {
    console.log('[TMDB Match] Starting movie matching with year-aware lookup...');
    console.time('[TMDB Match] Download exports');
    const exports = await getEnrichedMovieExports();
    console.timeEnd('[TMDB Match] Download exports');

    // Get only movies that haven't been matched AND haven't been attempted
    // Query by source_id, filter for unmatched (tmdb_id undefined means not in compound index)
    console.time('[TMDB Match] Query unmatched');
    const movies = await db.vodMovies
      .where('source_id')
      .equals(sourceId)
      .filter(m => !m.tmdb_id && !m.match_attempted)
      .toArray();
    console.timeEnd('[TMDB Match] Query unmatched');

    if (movies.length === 0) {
      console.log('[TMDB Match] No new movies to match');
      return 0;
    }

    console.log(`[TMDB Match] Matching ${movies.length} new movies...`);
    console.time('[TMDB Match] Matching loop');

    let matched = 0;
    let yearMatched = 0;
    const BATCH_SIZE = 500;
    const now = new Date();

    for (let i = 0; i < movies.length; i += BATCH_SIZE) {
      const batch = movies.slice(i, i + BATCH_SIZE);
      const toUpdate: StoredMovie[] = [];

      for (const movie of batch) {
        // Extract title and year from movie data
        const { title, year } = extractMatchParams(movie);
        const match = findBestMatch(exports, title, year);

        if (match) {
          // Track if we matched on year specifically
          if (year && match.year === year) {
            yearMatched++;
          }
          toUpdate.push({
            ...movie,
            tmdb_id: match.id,
            popularity: match.popularity,
            match_attempted: now,
          });
          matched++;
        } else {
          // Mark as attempted even if no match found (prevents re-trying)
          toUpdate.push({
            ...movie,
            match_attempted: now,
          });
        }
      }

      // Bulk update - much faster than individual updates
      if (toUpdate.length > 0) {
        await db.vodMovies.bulkPut(toUpdate);
      }

      console.log(`[TMDB Match] Progress: ${Math.min(i + BATCH_SIZE, movies.length)}/${movies.length}`);
    }

    console.timeEnd('[TMDB Match] Matching loop');
    console.log(`[TMDB Match] Matched ${matched}/${movies.length} movies (${yearMatched} with exact year match)`);
    return matched;
  } catch (error) {
    console.error('[TMDB Match] Movie matching failed:', error);
    return 0;
  }
}

// Match series against TMDB exports (no API calls!)
// Uses enriched data with year info for more accurate matching
// Only matches items that haven't been attempted yet (incremental)
async function matchSeriesWithTmdb(sourceId: string): Promise<number> {
  try {
    console.log('[TMDB Match] Starting series matching with year-aware lookup...');
    console.time('[TMDB Match] Download TV exports');
    const exports = await getEnrichedTvExports();
    console.timeEnd('[TMDB Match] Download TV exports');

    // Get only series that haven't been matched AND haven't been attempted
    // Query by source_id, filter for unmatched
    console.time('[TMDB Match] Query unmatched series');
    const series = await db.vodSeries
      .where('source_id')
      .equals(sourceId)
      .filter(s => !s.tmdb_id && !s.match_attempted)
      .toArray();
    console.timeEnd('[TMDB Match] Query unmatched series');

    if (series.length === 0) {
      console.log('[TMDB Match] No new series to match');
      return 0;
    }

    console.log(`[TMDB Match] Matching ${series.length} new series...`);
    console.time('[TMDB Match] Series matching loop');

    let matched = 0;
    let yearMatched = 0;
    const BATCH_SIZE = 500;
    const now = new Date();

    for (let i = 0; i < series.length; i += BATCH_SIZE) {
      const batch = series.slice(i, i + BATCH_SIZE);
      const toUpdate: StoredSeries[] = [];

      for (const s of batch) {
        // Extract title and year from series data
        const { title, year } = extractMatchParams(s);
        const match = findBestMatch(exports, title, year);

        if (match) {
          // Track if we matched on year specifically
          if (year && match.year === year) {
            yearMatched++;
          }
          toUpdate.push({
            ...s,
            tmdb_id: match.id,
            popularity: match.popularity,
            match_attempted: now,
          });
          matched++;
        } else {
          // Mark as attempted even if no match found (prevents re-trying)
          toUpdate.push({
            ...s,
            match_attempted: now,
          });
        }
      }

      // Bulk update - much faster than individual updates
      if (toUpdate.length > 0) {
        await db.vodSeries.bulkPut(toUpdate);
      }

      console.log(`[TMDB Match] Progress: ${Math.min(i + BATCH_SIZE, series.length)}/${series.length}`);
    }

    console.timeEnd('[TMDB Match] Series matching loop');
    console.log(`[TMDB Match] Matched ${matched}/${series.length} series (${yearMatched} with exact year match)`);
    return matched;
  } catch (error) {
    console.error('[TMDB Match] Series matching failed:', error);
    return 0;
  }
}

// Sync all VOD content for a source
export async function syncVodForSource(source: Source): Promise<VodSyncResult> {
  try {
    const [moviesResult, seriesResult] = await Promise.all([
      syncVodMovies(source),
      syncVodSeries(source),
    ]);

    // Update source meta with VOD counts and sync timestamp
    const meta = await db.sourcesMeta.get(source.id);
    if (meta) {
      await db.sourcesMeta.update(source.id, {
        vod_movie_count: moviesResult.count,
        vod_series_count: seriesResult.count,
        vod_last_synced: new Date(),
      });
    } else {
      // Create meta if it doesn't exist (shouldn't happen, but be safe)
      await db.sourcesMeta.put({
        source_id: source.id,
        channel_count: 0,
        category_count: 0,
        vod_movie_count: moviesResult.count,
        vod_series_count: seriesResult.count,
        vod_last_synced: new Date(),
      });
    }

    // Match against TMDB exports (runs in background, no API calls)
    // This enriches movies/series with tmdb_id for the curated lists
    // Uses reference counting to handle concurrent syncs correctly
    startTmdbMatching();
    Promise.all([
      matchMoviesWithTmdb(source.id),
      matchSeriesWithTmdb(source.id),
    ])
      .catch(console.error)
      .finally(() => {
        endTmdbMatching();
      });

    return {
      success: true,
      movieCount: moviesResult.count,
      seriesCount: seriesResult.count,
      movieCategoryCount: moviesResult.categoryCount,
      seriesCategoryCount: seriesResult.categoryCount,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      movieCount: 0,
      seriesCount: 0,
      movieCategoryCount: 0,
      seriesCategoryCount: 0,
      error: errorMsg,
    };
  }
}

// Sync VOD for all Xtream sources
export async function syncAllVod(): Promise<Map<string, VodSyncResult>> {
  const results = new Map<string, VodSyncResult>();

  if (!window.storage) {
    console.error('Storage API not available');
    return results;
  }

  const sourcesResult = await window.storage.getSources();
  if (!sourcesResult.data) {
    console.error('Failed to get sources:', sourcesResult.error);
    return results;
  }

  // Sync VOD for each enabled Xtream source
  for (const source of sourcesResult.data) {
    if (source.enabled && source.type === 'xtream') {
      console.log(`Syncing VOD for source: ${source.name}`);
      const result = await syncVodForSource(source);
      results.set(source.id, result);
      console.log(`  → ${result.success ? 'OK' : 'FAILED'}: ${result.movieCount} movies, ${result.seriesCount} series`);
    }
  }

  return results;
}
