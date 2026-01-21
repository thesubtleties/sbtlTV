/**
 * TMDB Service
 *
 * Wrapper around tmdb-ts for fetching movie/series metadata,
 * trending lists, and search functionality.
 */

import { TMDB } from 'tmdb-ts';

// TMDB image base URLs
export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';
export const TMDB_POSTER_SIZES = {
  small: 'w185',
  medium: 'w342',
  large: 'w500',
  original: 'original',
} as const;
export const TMDB_BACKDROP_SIZES = {
  small: 'w300',
  medium: 'w780',
  large: 'w1280',
  original: 'original',
} as const;

// Helper to build full image URL
export function getTmdbImageUrl(
  path: string | null | undefined,
  size: string = TMDB_POSTER_SIZES.medium
): string | null {
  if (!path) return null;
  return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

// Singleton instance
let tmdbInstance: TMDB | null = null;
let currentApiKey: string | null = null;

/**
 * Initialize or get TMDB client
 */
export function getTmdb(apiKey: string): TMDB {
  if (!tmdbInstance || currentApiKey !== apiKey) {
    tmdbInstance = new TMDB(apiKey);
    currentApiKey = apiKey;
  }
  return tmdbInstance;
}

/**
 * Check if TMDB is configured
 */
export function isTmdbConfigured(): boolean {
  return tmdbInstance !== null && currentApiKey !== null;
}

/**
 * Clear TMDB instance (for logout/key change)
 */
export function clearTmdb(): void {
  tmdbInstance = null;
  currentApiKey = null;
}

// ===========================================================================
// Movie endpoints
// ===========================================================================

export interface TmdbMovieResult {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string;
  vote_average: number;
  vote_count: number;
  popularity: number;
  genre_ids: number[];
  adult: boolean;
}

export interface TmdbMovieDetails extends TmdbMovieResult {
  imdb_id: string | null;
  runtime: number;
  genres: Array<{ id: number; name: string }>;
  tagline: string;
  status: string;
  budget: number;
  revenue: number;
}

/**
 * Get trending movies
 */
export async function getTrendingMovies(
  apiKey: string,
  timeWindow: 'day' | 'week' = 'week'
): Promise<TmdbMovieResult[]> {
  const tmdb = getTmdb(apiKey);
  const response = await tmdb.trending.trending('movie', timeWindow);
  return response.results as unknown as TmdbMovieResult[];
}

/**
 * Get popular movies
 */
export async function getPopularMovies(
  apiKey: string,
  page = 1
): Promise<TmdbMovieResult[]> {
  const tmdb = getTmdb(apiKey);
  const response = await tmdb.movies.popular({ page });
  return response.results as TmdbMovieResult[];
}

/**
 * Get top rated movies
 */
export async function getTopRatedMovies(
  apiKey: string,
  page = 1
): Promise<TmdbMovieResult[]> {
  const tmdb = getTmdb(apiKey);
  const response = await tmdb.movies.topRated({ page });
  return response.results as TmdbMovieResult[];
}

/**
 * Search movies
 */
export async function searchMovies(
  apiKey: string,
  query: string,
  year?: number
): Promise<TmdbMovieResult[]> {
  const tmdb = getTmdb(apiKey);
  const response = await tmdb.search.movies({ query, year });
  return response.results as TmdbMovieResult[];
}

/**
 * Get movie details
 */
export async function getMovieDetails(
  apiKey: string,
  movieId: number
): Promise<TmdbMovieDetails> {
  const tmdb = getTmdb(apiKey);
  const details = await tmdb.movies.details(movieId);
  return details as unknown as TmdbMovieDetails;
}

// ===========================================================================
// TV Show endpoints
// ===========================================================================

export interface TmdbTvResult {
  id: number;
  name: string;
  original_name: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  first_air_date: string;
  vote_average: number;
  vote_count: number;
  popularity: number;
  genre_ids: number[];
}

export interface TmdbTvDetails extends TmdbTvResult {
  number_of_seasons: number;
  number_of_episodes: number;
  genres: Array<{ id: number; name: string }>;
  status: string;
  tagline: string;
  episode_run_time: number[];
  external_ids?: {
    imdb_id: string | null;
  };
}

/**
 * Get trending TV shows
 */
export async function getTrendingTvShows(
  apiKey: string,
  timeWindow: 'day' | 'week' = 'week'
): Promise<TmdbTvResult[]> {
  const tmdb = getTmdb(apiKey);
  const response = await tmdb.trending.trending('tv', timeWindow);
  return response.results as unknown as TmdbTvResult[];
}

/**
 * Get popular TV shows
 */
export async function getPopularTvShows(
  apiKey: string,
  page = 1
): Promise<TmdbTvResult[]> {
  const tmdb = getTmdb(apiKey);
  const response = await tmdb.tvShows.popular({ page });
  return response.results as TmdbTvResult[];
}

/**
 * Get top rated TV shows
 */
export async function getTopRatedTvShows(
  apiKey: string,
  page = 1
): Promise<TmdbTvResult[]> {
  const tmdb = getTmdb(apiKey);
  const response = await tmdb.tvShows.topRated({ page });
  return response.results as TmdbTvResult[];
}

/**
 * Search TV shows
 */
export async function searchTvShows(
  apiKey: string,
  query: string,
  firstAirDateYear?: number
): Promise<TmdbTvResult[]> {
  const tmdb = getTmdb(apiKey);
  const response = await tmdb.search.tvShows({ query, first_air_date_year: firstAirDateYear });
  return response.results as TmdbTvResult[];
}

/**
 * Get TV show details
 */
export async function getTvShowDetails(
  apiKey: string,
  tvId: number
): Promise<TmdbTvDetails> {
  const tmdb = getTmdb(apiKey);
  const details = await tmdb.tvShows.details(tvId);
  return details as unknown as TmdbTvDetails;
}

// ===========================================================================
// Genre endpoints
// ===========================================================================

export interface TmdbGenre {
  id: number;
  name: string;
}

/**
 * Get movie genres
 */
export async function getMovieGenres(apiKey: string): Promise<TmdbGenre[]> {
  const tmdb = getTmdb(apiKey);
  const response = await tmdb.genres.movies();
  return response.genres;
}

/**
 * Get TV genres
 */
export async function getTvGenres(apiKey: string): Promise<TmdbGenre[]> {
  const tmdb = getTmdb(apiKey);
  const response = await tmdb.genres.tvShows();
  return response.genres;
}

// ===========================================================================
// Discovery endpoints
// ===========================================================================

/**
 * Discover movies by genre
 */
export async function discoverMoviesByGenre(
  apiKey: string,
  genreId: number,
  page = 1
): Promise<TmdbMovieResult[]> {
  const tmdb = getTmdb(apiKey);
  const response = await tmdb.discover.movie({
    with_genres: String(genreId),
    page,
    sort_by: 'popularity.desc',
  });
  return response.results as TmdbMovieResult[];
}

/**
 * Discover TV shows by genre
 */
export async function discoverTvShowsByGenre(
  apiKey: string,
  genreId: number,
  page = 1
): Promise<TmdbTvResult[]> {
  const tmdb = getTmdb(apiKey);
  const response = await tmdb.discover.tvShow({
    with_genres: String(genreId),
    page,
    sort_by: 'popularity.desc',
  });
  return response.results as TmdbTvResult[];
}

// ===========================================================================
// Validation
// ===========================================================================

/**
 * Validate TMDB API key
 */
export async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    const tmdb = new TMDB(apiKey);
    // Try to fetch a simple endpoint
    await tmdb.genres.movies();
    return true;
  } catch {
    return false;
  }
}
