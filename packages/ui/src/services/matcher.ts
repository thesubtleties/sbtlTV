/**
 * Matcher Service
 *
 * Matches local Xtream VOD content to TMDB entries for metadata enrichment.
 * Uses title + year fuzzy matching as primary strategy.
 */

import { db, type StoredMovie, type StoredSeries } from '../db';
import {
  searchMovies,
  searchTvShows,
  getMovieDetails,
  getTvShowDetails,
  type TmdbMovieResult,
  type TmdbTvResult,
} from './tmdb';

// ===========================================================================
// String Similarity (Levenshtein Distance)
// ===========================================================================

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity ratio (0-1) between two strings
 */
function stringSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase());
  return 1 - distance / maxLen;
}

/**
 * Normalize title for comparison
 * Removes common suffixes, year patterns, quality markers, etc.
 */
function normalizeTitle(title: string): string {
  return title
    // Remove year in various formats
    .replace(/\s*\(\d{4}\)\s*/g, ' ')
    .replace(/\s*\[\d{4}\]\s*/g, ' ')
    .replace(/\s+\d{4}$/g, '')
    // Remove quality markers
    .replace(/\s*(4K|UHD|HD|SD|1080p|720p|480p|BluRay|WEB-DL|HDRip|DVDRip)\s*/gi, ' ')
    // Remove common suffixes
    .replace(/\s*(Extended|Director'?s?\s*Cut|Unrated|Theatrical)\s*/gi, ' ')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Extract year from title if present
 */
function extractYear(title: string): number | null {
  const match = title.match(/\((\d{4})\)|\[(\d{4})\]|\s(\d{4})$/);
  if (match) {
    const year = parseInt(match[1] || match[2] || match[3], 10);
    if (year >= 1900 && year <= new Date().getFullYear() + 2) {
      return year;
    }
  }
  return null;
}

// ===========================================================================
// Movie Matching
// ===========================================================================

export interface MatchResult {
  tmdbId: number;
  confidence: number; // 0-1
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  popularity: number;
}

/**
 * Find best TMDB match for a movie
 */
export async function matchMovie(
  apiKey: string,
  movie: StoredMovie
): Promise<MatchResult | null> {
  const normalizedTitle = normalizeTitle(movie.name);
  const year = extractYear(movie.name) ||
    (movie.release_date ? parseInt(movie.release_date.slice(0, 4), 10) : undefined);

  // Search TMDB
  const results = await searchMovies(apiKey, normalizedTitle, year);

  if (results.length === 0) {
    // Try without year
    const fallbackResults = await searchMovies(apiKey, normalizedTitle);
    if (fallbackResults.length === 0) return null;
    return findBestMovieMatch(normalizedTitle, year, fallbackResults);
  }

  return findBestMovieMatch(normalizedTitle, year, results);
}

function findBestMovieMatch(
  normalizedTitle: string,
  year: number | undefined,
  results: TmdbMovieResult[]
): MatchResult | null {
  let bestMatch: MatchResult | null = null;
  let bestScore = 0;

  for (const result of results) {
    const tmdbTitle = normalizeTitle(result.title);
    const tmdbOriginalTitle = normalizeTitle(result.original_title);
    const tmdbYear = result.release_date
      ? parseInt(result.release_date.slice(0, 4), 10)
      : null;

    // Calculate title similarity
    const titleSim = Math.max(
      stringSimilarity(normalizedTitle, tmdbTitle),
      stringSimilarity(normalizedTitle, tmdbOriginalTitle)
    );

    // Year bonus/penalty
    let yearScore = 0.5; // neutral if no year info
    if (year && tmdbYear) {
      const yearDiff = Math.abs(year - tmdbYear);
      if (yearDiff === 0) yearScore = 1;
      else if (yearDiff === 1) yearScore = 0.8;
      else if (yearDiff <= 2) yearScore = 0.5;
      else yearScore = 0.1;
    }

    // Combined score
    const score = titleSim * 0.7 + yearScore * 0.3;

    if (score > bestScore && score > 0.6) {
      bestScore = score;
      bestMatch = {
        tmdbId: result.id,
        confidence: score,
        title: result.title,
        posterPath: result.poster_path,
        backdropPath: result.backdrop_path,
        popularity: result.popularity,
      };
    }
  }

  return bestMatch;
}

/**
 * Match and update a movie in the database
 */
export async function matchAndUpdateMovie(
  apiKey: string,
  movie: StoredMovie
): Promise<boolean> {
  const match = await matchMovie(apiKey, movie);

  if (match && match.confidence > 0.7) {
    // Get IMDB ID from detailed info
    let imdbId: string | undefined;
    try {
      const details = await getMovieDetails(apiKey, match.tmdbId);
      imdbId = details.imdb_id ?? undefined;
    } catch {
      // Ignore - IMDB ID is optional
    }

    // Update movie in database
    await db.vodMovies.update(movie.stream_id, {
      tmdb_id: match.tmdbId,
      imdb_id: imdbId,
      backdrop_path: match.backdropPath ?? undefined,
      popularity: match.popularity,
    });

    return true;
  }

  return false;
}

// ===========================================================================
// Series Matching
// ===========================================================================

/**
 * Find best TMDB match for a series
 */
export async function matchSeries(
  apiKey: string,
  series: StoredSeries
): Promise<MatchResult | null> {
  const normalizedTitle = normalizeTitle(series.name);
  const year = extractYear(series.name) ||
    (series.release_date ? parseInt(series.release_date.slice(0, 4), 10) : undefined);

  // Search TMDB
  const results = await searchTvShows(apiKey, normalizedTitle, year);

  if (results.length === 0) {
    // Try without year
    const fallbackResults = await searchTvShows(apiKey, normalizedTitle);
    if (fallbackResults.length === 0) return null;
    return findBestSeriesMatch(normalizedTitle, year, fallbackResults);
  }

  return findBestSeriesMatch(normalizedTitle, year, results);
}

function findBestSeriesMatch(
  normalizedTitle: string,
  year: number | undefined,
  results: TmdbTvResult[]
): MatchResult | null {
  let bestMatch: MatchResult | null = null;
  let bestScore = 0;

  for (const result of results) {
    const tmdbTitle = normalizeTitle(result.name);
    const tmdbOriginalTitle = normalizeTitle(result.original_name);
    const tmdbYear = result.first_air_date
      ? parseInt(result.first_air_date.slice(0, 4), 10)
      : null;

    // Calculate title similarity
    const titleSim = Math.max(
      stringSimilarity(normalizedTitle, tmdbTitle),
      stringSimilarity(normalizedTitle, tmdbOriginalTitle)
    );

    // Year bonus/penalty
    let yearScore = 0.5;
    if (year && tmdbYear) {
      const yearDiff = Math.abs(year - tmdbYear);
      if (yearDiff === 0) yearScore = 1;
      else if (yearDiff === 1) yearScore = 0.8;
      else if (yearDiff <= 2) yearScore = 0.5;
      else yearScore = 0.1;
    }

    // Combined score
    const score = titleSim * 0.7 + yearScore * 0.3;

    if (score > bestScore && score > 0.6) {
      bestScore = score;
      bestMatch = {
        tmdbId: result.id,
        confidence: score,
        title: result.name,
        posterPath: result.poster_path,
        backdropPath: result.backdrop_path,
        popularity: result.popularity,
      };
    }
  }

  return bestMatch;
}

/**
 * Match and update a series in the database
 */
export async function matchAndUpdateSeries(
  apiKey: string,
  series: StoredSeries
): Promise<boolean> {
  const match = await matchSeries(apiKey, series);

  if (match && match.confidence > 0.7) {
    // Get IMDB ID from detailed info
    let imdbId: string | undefined;
    try {
      const details = await getTvShowDetails(apiKey, match.tmdbId);
      imdbId = details.external_ids?.imdb_id ?? undefined;
    } catch {
      // Ignore - IMDB ID is optional
    }

    // Update series in database
    await db.vodSeries.update(series.series_id, {
      tmdb_id: match.tmdbId,
      imdb_id: imdbId,
      backdrop_path: match.backdropPath ?? undefined,
      popularity: match.popularity,
    });

    return true;
  }

  return false;
}

// ===========================================================================
// Batch Matching
// ===========================================================================

export interface BatchMatchResult {
  matched: number;
  failed: number;
  total: number;
}

/**
 * Match movies in batches (with rate limiting)
 */
export async function batchMatchMovies(
  apiKey: string,
  movies: StoredMovie[],
  onProgress?: (current: number, total: number) => void
): Promise<BatchMatchResult> {
  let matched = 0;
  let failed = 0;
  const total = movies.length;

  // Process in batches to avoid rate limiting
  const BATCH_SIZE = 10;
  const DELAY_MS = 500;

  for (let i = 0; i < movies.length; i += BATCH_SIZE) {
    const batch = movies.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (movie) => {
        // Skip if already matched
        if (movie.tmdb_id) {
          matched++;
          return;
        }

        try {
          const success = await matchAndUpdateMovie(apiKey, movie);
          if (success) matched++;
          else failed++;
        } catch {
          failed++;
        }
      })
    );

    onProgress?.(Math.min(i + BATCH_SIZE, total), total);

    // Rate limit delay
    if (i + BATCH_SIZE < movies.length) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  return { matched, failed, total };
}

/**
 * Match series in batches (with rate limiting)
 */
export async function batchMatchSeries(
  apiKey: string,
  seriesList: StoredSeries[],
  onProgress?: (current: number, total: number) => void
): Promise<BatchMatchResult> {
  let matched = 0;
  let failed = 0;
  const total = seriesList.length;

  const BATCH_SIZE = 10;
  const DELAY_MS = 500;

  for (let i = 0; i < seriesList.length; i += BATCH_SIZE) {
    const batch = seriesList.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (series) => {
        if (series.tmdb_id) {
          matched++;
          return;
        }

        try {
          const success = await matchAndUpdateSeries(apiKey, series);
          if (success) matched++;
          else failed++;
        } catch {
          failed++;
        }
      })
    );

    onProgress?.(Math.min(i + BATCH_SIZE, total), total);

    if (i + BATCH_SIZE < seriesList.length) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  return { matched, failed, total };
}
