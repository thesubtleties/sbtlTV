/**
 * TMDB Daily Exports Service
 *
 * Downloads and caches TMDB daily ID exports for efficient local matching.
 * Avoids API rate limits by using pre-generated export files.
 *
 * Export files: https://developer.themoviedb.org/docs/daily-id-exports
 * Format: Line-delimited JSON (gzipped)
 * Fields: { id, original_title, adult, video, popularity }
 */

// ===========================================================================
// Types
// ===========================================================================

export interface TmdbExportEntry {
  id: number;
  original_title: string;  // For movies
  original_name?: string;  // For TV shows
  adult: boolean;
  video?: boolean;
  popularity: number;
}

export interface TmdbExportData {
  entries: Map<string, TmdbExportEntry[]>;  // normalized title -> entries
  byId: Map<number, TmdbExportEntry>;       // id -> entry
  lastUpdated: Date;
}

// ===========================================================================
// Cache
// ===========================================================================

let movieExportCache: TmdbExportData | null = null;
let tvExportCache: TmdbExportData | null = null;

// Cache for 24 hours
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ===========================================================================
// Helpers
// ===========================================================================

/**
 * Normalize title for matching
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    // Remove year patterns
    .replace(/\s*\(\d{4}\)\s*/g, ' ')
    .replace(/\s*\[\d{4}\]\s*/g, ' ')
    .replace(/\s+\d{4}$/g, '')
    // Remove quality markers
    .replace(/\s*(4k|uhd|hd|sd|1080p|720p|480p|bluray|web-dl|hdrip|dvdrip)\s*/gi, ' ')
    // Remove special chars
    .replace(/[^\w\s]/g, ' ')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Get today's date formatted for export filename
 */
function getExportDate(): string {
  const now = new Date();
  // Use yesterday's date to ensure the export is available
  now.setDate(now.getDate() - 1);
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const year = now.getFullYear();
  return `${month}_${day}_${year}`;
}

/**
 * Build export URL
 */
function buildExportUrl(type: 'movie' | 'tv'): string {
  const date = getExportDate();
  const fileType = type === 'movie' ? 'movie_ids' : 'tv_series_ids';
  return `https://files.tmdb.org/p/exports/${fileType}_${date}.json.gz`;
}

// ===========================================================================
// Download & Parse
// ===========================================================================

/**
 * Download and parse a TMDB export file
 */
async function downloadExport(type: 'movie' | 'tv'): Promise<TmdbExportData> {
  const url = buildExportUrl(type);
  console.log(`[TMDB Export] Downloading ${type} export from ${url}`);

  let gzippedData: ArrayBuffer;

  // Use Electron's binary fetch proxy (bypasses CORS, returns base64)
  if (typeof window !== 'undefined' && window.fetchProxy?.fetchBinary) {
    const result = await window.fetchProxy.fetchBinary(url);
    if (!result.success || !result.data) {
      throw new Error(result.error || 'Failed to fetch TMDB export');
    }
    // Decode base64 to ArrayBuffer
    const binaryString = atob(result.data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    gzippedData = bytes.buffer;
  } else {
    // Fallback to regular fetch (works in Node.js or when CORS is not an issue)
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download TMDB export: ${response.status}`);
    }
    gzippedData = await response.arrayBuffer();
  }

  // Decompress and parse using streaming (avoids ~200MB memory spike)
  const entries = new Map<string, TmdbExportEntry[]>();
  const byId = new Map<number, TmdbExportEntry>();

  // Create streaming pipeline: gzip → text decoder
  const decompressedStream = new Response(gzippedData).body!
    .pipeThrough(new DecompressionStream('gzip'))
    .pipeThrough(new TextDecoderStream());

  const reader = decompressedStream.getReader();
  let buffer = '';
  let lineCount = 0;

  console.log(`[TMDB Export] Parsing ${type} entries (streaming)...`);

  // Process chunks as they arrive
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += value;
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep incomplete line for next chunk

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const entry = JSON.parse(line) as TmdbExportEntry;

        // Skip adult content
        if (entry.adult) continue;

        // Get the title based on type
        const title = type === 'movie' ? entry.original_title : entry.original_name;
        if (!title) continue;

        // Normalize and index
        const normalized = normalizeTitle(title);
        if (!normalized) continue;

        // Add to title index
        const existing = entries.get(normalized) || [];
        existing.push(entry);
        entries.set(normalized, existing);

        // Add to ID index
        byId.set(entry.id, entry);
        lineCount++;
      } catch {
        // Skip malformed lines
      }
    }
  }

  // Process any remaining content in buffer
  if (buffer.trim()) {
    try {
      const entry = JSON.parse(buffer) as TmdbExportEntry;
      if (!entry.adult) {
        const title = type === 'movie' ? entry.original_title : entry.original_name;
        if (title) {
          const normalized = normalizeTitle(title);
          if (normalized) {
            const existing = entries.get(normalized) || [];
            existing.push(entry);
            entries.set(normalized, existing);
            byId.set(entry.id, entry);
            lineCount++;
          }
        }
      }
    } catch {
      // Skip malformed final line
    }
  }

  console.log(`[TMDB Export] Indexed ${entries.size} unique titles, ${byId.size} total entries (${lineCount} lines)`);

  return {
    entries,
    byId,
    lastUpdated: new Date(),
  };
}

// ===========================================================================
// Public API
// ===========================================================================

/**
 * Get movie export data (downloads if not cached)
 */
export async function getMovieExports(): Promise<TmdbExportData> {
  // Check cache
  if (movieExportCache) {
    const age = Date.now() - movieExportCache.lastUpdated.getTime();
    if (age < CACHE_TTL_MS) {
      return movieExportCache;
    }
  }

  // Download fresh data
  movieExportCache = await downloadExport('movie');
  return movieExportCache;
}

/**
 * Get TV export data (downloads if not cached)
 */
export async function getTvExports(): Promise<TmdbExportData> {
  // Check cache
  if (tvExportCache) {
    const age = Date.now() - tvExportCache.lastUpdated.getTime();
    if (age < CACHE_TTL_MS) {
      return tvExportCache;
    }
  }

  // Download fresh data
  tvExportCache = await downloadExport('tv');
  return tvExportCache;
}

/**
 * Find best TMDB match for a title using exports
 * Uses exact normalized title matching only (fast O(1) lookup)
 */
export function findBestMatch(
  exports: TmdbExportData,
  title: string
): TmdbExportEntry | null {
  const normalized = normalizeTitle(title);
  if (!normalized) return null;

  // Exact match using Map lookup - O(1)
  const matches = exports.entries.get(normalized);
  if (matches && matches.length > 0) {
    // Return most popular among matches
    return matches.reduce((best, current) =>
      current.popularity > best.popularity ? current : best
    );
  }

  // Try without "the" prefix
  const withoutThe = normalized.replace(/^the\s+/, '');
  if (withoutThe !== normalized) {
    const matches2 = exports.entries.get(withoutThe);
    if (matches2 && matches2.length > 0) {
      return matches2.reduce((best, current) =>
        current.popularity > best.popularity ? current : best
      );
    }
  }

  return null;
}

/**
 * Batch match movies against exports
 */
export async function batchMatchFromExports(
  titles: { id: string; title: string }[],
  type: 'movie' | 'tv',
  onProgress?: (current: number, total: number) => void
): Promise<Map<string, number>> {
  const exports = type === 'movie' ? await getMovieExports() : await getTvExports();
  const results = new Map<string, number>();

  for (let i = 0; i < titles.length; i++) {
    const { id, title } = titles[i];
    const match = findBestMatch(exports, title);

    if (match) {
      results.set(id, match.id);
    }

    // Report progress every 100 items
    if (onProgress && (i + 1) % 100 === 0) {
      onProgress(i + 1, titles.length);
    }
  }

  onProgress?.(titles.length, titles.length);
  return results;
}

/**
 * Clear cached exports (force re-download)
 */
export function clearExportCache(): void {
  movieExportCache = null;
  tvExportCache = null;
}
