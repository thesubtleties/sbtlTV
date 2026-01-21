import { db, clearSourceData, clearVodData, type SourceMeta, type StoredProgram, type StoredMovie, type StoredSeries, type StoredEpisode, type VodCategory } from './index';
import { fetchAndParseM3U, XtreamClient } from '@sbtltv/local-adapter';
import type { Source, Channel, Category, Movie, Series } from '@sbtltv/core';
import { getMovieExports, getTvExports, findBestMatch } from '../services/tmdb-exports';

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

// ===========================================================================
// VOD Sync Functions
// ===========================================================================

// Sync VOD movies for a single Xtream source
export async function syncVodMovies(source: Source): Promise<{ count: number; categoryCount: number }> {
  if (source.type !== 'xtream' || !source.username || !source.password) {
    return { count: 0, categoryCount: 0 };
  }

  const client = new XtreamClient(
    { baseUrl: source.url, username: source.username, password: source.password },
    source.id
  );

  // Fetch categories and movies
  const categories = await client.getVodCategories();
  const movies = await client.getVodStreams();

  // Convert categories to VodCategory format
  const vodCategories: VodCategory[] = categories.map(cat => ({
    category_id: cat.category_id,
    source_id: source.id,
    name: cat.category_name,
    type: 'movie' as const,
  }));

  // Convert movies to StoredMovie format
  const storedMovies: StoredMovie[] = movies.map(movie => ({
    ...movie,
    added: new Date(),
  }));

  // Store in batches
  const BATCH_SIZE = 500;

  await db.transaction('rw', [db.vodMovies, db.vodCategories], async () => {
    // Clear existing movies for this source
    await db.vodMovies.where('source_id').equals(source.id).delete();
    await db.vodCategories.where('source_id').equals(source.id).filter(c => c.type === 'movie').delete();

    // Store categories
    if (vodCategories.length > 0) {
      await db.vodCategories.bulkPut(vodCategories);
    }

    // Store movies in batches
    for (let i = 0; i < storedMovies.length; i += BATCH_SIZE) {
      const batch = storedMovies.slice(i, i + BATCH_SIZE);
      await db.vodMovies.bulkPut(batch);
    }
  });

  return { count: storedMovies.length, categoryCount: vodCategories.length };
}

// Sync VOD series for a single Xtream source
export async function syncVodSeries(source: Source): Promise<{ count: number; categoryCount: number }> {
  if (source.type !== 'xtream' || !source.username || !source.password) {
    return { count: 0, categoryCount: 0 };
  }

  const client = new XtreamClient(
    { baseUrl: source.url, username: source.username, password: source.password },
    source.id
  );

  // Fetch categories and series
  const categories = await client.getSeriesCategories();
  const series = await client.getSeries();

  // Convert categories to VodCategory format
  const vodCategories: VodCategory[] = categories.map(cat => ({
    category_id: cat.category_id,
    source_id: source.id,
    name: cat.category_name,
    type: 'series' as const,
  }));

  // Convert series to StoredSeries format
  const storedSeries: StoredSeries[] = series.map(s => ({
    ...s,
    added: new Date(),
  }));

  // Store in batches
  const BATCH_SIZE = 500;

  await db.transaction('rw', [db.vodSeries, db.vodCategories], async () => {
    // Clear existing series for this source
    await db.vodSeries.where('source_id').equals(source.id).delete();
    await db.vodCategories.where('source_id').equals(source.id).filter(c => c.type === 'series').delete();

    // Store categories
    if (vodCategories.length > 0) {
      await db.vodCategories.bulkPut(vodCategories);
    }

    // Store series in batches
    for (let i = 0; i < storedSeries.length; i += BATCH_SIZE) {
      const batch = storedSeries.slice(i, i + BATCH_SIZE);
      await db.vodSeries.bulkPut(batch);
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
async function matchMoviesWithTmdb(sourceId: string): Promise<number> {
  try {
    console.log('[TMDB Match] Starting movie matching...');
    const exports = await getMovieExports();

    // Get all movies without tmdb_id for this source
    const movies = await db.vodMovies
      .where('source_id')
      .equals(sourceId)
      .filter(m => !m.tmdb_id)
      .toArray();

    console.log(`[TMDB Match] Matching ${movies.length} movies...`);

    let matched = 0;
    const BATCH_SIZE = 500;

    for (let i = 0; i < movies.length; i += BATCH_SIZE) {
      const batch = movies.slice(i, i + BATCH_SIZE);
      const updates: { key: string; changes: Partial<StoredMovie> }[] = [];

      for (const movie of batch) {
        const match = findBestMatch(exports, movie.name);
        if (match) {
          updates.push({
            key: movie.stream_id,
            changes: {
              tmdb_id: match.id,
              popularity: match.popularity,
            },
          });
          matched++;
        }
      }

      // Batch update
      if (updates.length > 0) {
        await db.transaction('rw', db.vodMovies, async () => {
          for (const { key, changes } of updates) {
            await db.vodMovies.update(key, changes);
          }
        });
      }

      console.log(`[TMDB Match] Progress: ${Math.min(i + BATCH_SIZE, movies.length)}/${movies.length}`);
    }

    console.log(`[TMDB Match] Matched ${matched}/${movies.length} movies`);
    return matched;
  } catch (error) {
    console.error('[TMDB Match] Movie matching failed:', error);
    return 0;
  }
}

// Match series against TMDB exports (no API calls!)
async function matchSeriesWithTmdb(sourceId: string): Promise<number> {
  try {
    console.log('[TMDB Match] Starting series matching...');
    const exports = await getTvExports();

    // Get all series without tmdb_id for this source
    const series = await db.vodSeries
      .where('source_id')
      .equals(sourceId)
      .filter(s => !s.tmdb_id)
      .toArray();

    console.log(`[TMDB Match] Matching ${series.length} series...`);

    let matched = 0;
    const BATCH_SIZE = 500;

    for (let i = 0; i < series.length; i += BATCH_SIZE) {
      const batch = series.slice(i, i + BATCH_SIZE);
      const updates: { key: string; changes: Partial<StoredSeries> }[] = [];

      for (const s of batch) {
        const match = findBestMatch(exports, s.name);
        if (match) {
          updates.push({
            key: s.series_id,
            changes: {
              tmdb_id: match.id,
              popularity: match.popularity,
            },
          });
          matched++;
        }
      }

      // Batch update
      if (updates.length > 0) {
        await db.transaction('rw', db.vodSeries, async () => {
          for (const { key, changes } of updates) {
            await db.vodSeries.update(key, changes);
          }
        });
      }

      console.log(`[TMDB Match] Progress: ${Math.min(i + BATCH_SIZE, series.length)}/${series.length}`);
    }

    console.log(`[TMDB Match] Matched ${matched}/${series.length} series`);
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

    // Update source meta with VOD counts
    const meta = await db.sourcesMeta.get(source.id);
    if (meta) {
      await db.sourcesMeta.update(source.id, {
        vod_movie_count: moviesResult.count,
        vod_series_count: seriesResult.count,
      });
    }

    // Match against TMDB exports (runs in background, no API calls)
    // This enriches movies/series with tmdb_id for the curated lists
    matchMoviesWithTmdb(source.id).catch(console.error);
    matchSeriesWithTmdb(source.id).catch(console.error);

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
