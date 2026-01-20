import { useState, useCallback, useEffect } from 'react';
import { HeroSection } from './vod/HeroSection';
import { HorizontalCarousel } from './vod/HorizontalCarousel';
import { HorizontalCategoryStrip } from './vod/HorizontalCategoryStrip';
import { VodBrowse } from './vod/VodBrowse';
import { MovieDetail } from './vod/MovieDetail';
import { useRecentMovies, useVodCategories } from '../hooks/useVod';
import {
  useTrendingMovies,
  usePopularMovies,
  useLocalPopularMovies,
  useMoviesByGenre,
  useFeaturedContent,
  useTmdbApiKey,
  useMovieGenres,
} from '../hooks/useTmdbLists';
import { useMoviesCategory, useSetMoviesCategory } from '../stores/uiStore';
import type { StoredMovie, StoredSeries } from '../db';
import './MoviesPage.css';

interface MoviesPageProps {
  onPlay?: (url: string, title: string) => void;
  onClose?: () => void;
}

export function MoviesPage({ onPlay, onClose }: MoviesPageProps) {
  const [selectedMovie, setSelectedMovie] = useState<StoredMovie | null>(null);
  const selectedCategoryId = useMoviesCategory();
  const setSelectedCategoryId = useSetMoviesCategory();
  const [searchQuery, setSearchQuery] = useState('');

  // API key for TMDB
  const tmdbApiKey = useTmdbApiKey();

  // Genres from TMDB
  const { genres } = useMovieGenres(tmdbApiKey);

  // Featured content for hero
  const { items: featuredItems } = useFeaturedContent(tmdbApiKey, 'movies', 5);

  // Trending and popular from TMDB (if API key available)
  const { movies: trendingMovies, loading: trendingLoading } = useTrendingMovies(tmdbApiKey);
  const { movies: popularMovies, loading: popularLoading } = usePopularMovies(tmdbApiKey);

  // Fallback: local popularity
  const { movies: localPopularMovies } = useLocalPopularMovies(20);

  // Recently added
  const { movies: recentMovies, loading: recentLoading } = useRecentMovies(20);

  // VOD categories
  const { categories } = useVodCategories('movie');

  // Get selected category name for VodBrowse
  const selectedCategory = categories.find(c => c.category_id === selectedCategoryId);

  // Genre-based list (show first genre if available)
  const firstGenre = genres[0];
  const { movies: genreMovies } = useMoviesByGenre(tmdbApiKey, firstGenre?.id ?? null);

  const handleItemClick = useCallback((item: StoredMovie | StoredSeries) => {
    setSelectedMovie(item as StoredMovie);
  }, []);

  const handlePlay = useCallback((movie: StoredMovie) => {
    if (onPlay) {
      onPlay(movie.direct_url, movie.name);
    }
  }, [onPlay]);

  const handleCloseDetail = useCallback(() => {
    setSelectedMovie(null);
  }, []);

  // Handle search Enter - switch to All tab if on Home
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      // If on Home, switch to All to show search results
      if (selectedCategoryId === null) {
        setSelectedCategoryId('all');
      }
    }
  }, [searchQuery, selectedCategoryId, setSelectedCategoryId]);

  // Handle category selection - also close detail view
  const handleCategorySelect = useCallback((id: string | null) => {
    setSelectedCategoryId(id);
    setSelectedMovie(null); // Close detail when changing category
  }, [setSelectedCategoryId]);

  // Handle mouse back button - close detail view
  useEffect(() => {
    const handleMouseBack = (e: MouseEvent) => {
      // Mouse button 3 = back, button 4 = forward
      if (e.button === 3 && selectedMovie) {
        e.preventDefault();
        setSelectedMovie(null);
      }
    };

    // Also handle browser back navigation
    const handlePopState = () => {
      if (selectedMovie) {
        setSelectedMovie(null);
      }
    };

    window.addEventListener('mousedown', handleMouseBack);
    window.addEventListener('popstate', handlePopState);

    // Push state when opening detail so back button works
    if (selectedMovie) {
      window.history.pushState({ movieDetail: true }, '');
    }

    return () => {
      window.removeEventListener('mousedown', handleMouseBack);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [selectedMovie]);

  // Determine which movies to show in carousels
  const showTmdbContent = tmdbApiKey && (trendingMovies.length > 0 || popularMovies.length > 0);

  return (
    <div className="movies-page">
      {/* Header with search */}
      <header className="movies-page__header">
        <button className="movies-page__close" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        <h1 className="movies-page__title">Movies</h1>

        <div className="movies-page__search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search movies..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} aria-label="Clear search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </header>

      {/* Category strip */}
      <HorizontalCategoryStrip
        categories={categories.map(c => ({ id: c.category_id, name: c.name }))}
        selectedId={selectedCategoryId}
        onSelect={handleCategorySelect}
      />

      {/* Main content */}
      <main className="movies-page__content">
        {selectedCategoryId === 'all' ? (
          // All movies: Virtualized grid with no filter
          <VodBrowse
            type="movies"
            categoryId={null}
            categoryName="All Movies"
            search={searchQuery || undefined}
            onItemClick={handleItemClick}
          />
        ) : selectedCategoryId && selectedCategory ? (
          // Category view: Virtualized grid filtered by category
          <VodBrowse
            type="movies"
            categoryId={selectedCategoryId}
            categoryName={selectedCategory.name}
            search={searchQuery || undefined}
            onItemClick={handleItemClick}
          />
        ) : (
          // Home view: Hero + carousels
          <>
            {/* Hero section */}
            <HeroSection
              items={featuredItems.length > 0 ? (featuredItems as StoredMovie[]) : localPopularMovies.slice(0, 5)}
              type="movie"
              onPlay={(item) => handlePlay(item as StoredMovie)}
              onMoreInfo={(item) => handleItemClick(item)}
              apiKey={tmdbApiKey}
            />

            {/* Carousels */}
            <div className="movies-page__carousels">
              {showTmdbContent ? (
                <>
                  {trendingMovies.length > 0 && (
                    <HorizontalCarousel
                      title="Trending Now"
                      items={trendingMovies}
                      type="movie"
                      onItemClick={handleItemClick}
                      loading={trendingLoading}
                    />
                  )}

                  {popularMovies.length > 0 && (
                    <HorizontalCarousel
                      title="Popular"
                      items={popularMovies}
                      type="movie"
                      onItemClick={handleItemClick}
                      loading={popularLoading}
                    />
                  )}

                  {firstGenre && genreMovies.length > 0 && (
                    <HorizontalCarousel
                      title={firstGenre.name}
                      items={genreMovies}
                      type="movie"
                      onItemClick={handleItemClick}
                    />
                  )}
                </>
              ) : (
                // Fallback without TMDB
                <HorizontalCarousel
                  title="Popular"
                  items={localPopularMovies}
                  type="movie"
                  onItemClick={handleItemClick}
                />
              )}

              <HorizontalCarousel
                title="Recently Added"
                items={recentMovies}
                type="movie"
                onItemClick={handleItemClick}
                loading={recentLoading}
              />
            </div>
          </>
        )}
      </main>

      {/* Movie detail modal */}
      {selectedMovie && (
        <MovieDetail
          movie={selectedMovie}
          onClose={handleCloseDetail}
          onPlay={handlePlay}
          apiKey={tmdbApiKey}
        />
      )}
    </div>
  );
}

export default MoviesPage;
