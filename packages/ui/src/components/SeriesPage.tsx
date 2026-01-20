import { useState, useCallback, useEffect } from 'react';
import { HeroSection } from './vod/HeroSection';
import { HorizontalCarousel } from './vod/HorizontalCarousel';
import { HorizontalCategoryStrip } from './vod/HorizontalCategoryStrip';
import { VodBrowse } from './vod/VodBrowse';
import { SeriesDetail } from './vod/SeriesDetail';
import { useRecentSeries, useVodCategories } from '../hooks/useVod';
import {
  useTrendingSeries,
  usePopularSeries,
  useLocalPopularSeries,
  useSeriesByGenre,
  useFeaturedContent,
  useTmdbApiKey,
  useTvGenres,
} from '../hooks/useTmdbLists';
import { useSeriesCategory, useSetSeriesCategory } from '../stores/uiStore';
import type { StoredMovie, StoredSeries } from '../db';
import './SeriesPage.css';

interface SeriesPageProps {
  onPlay?: (url: string, title: string) => void;
  onClose?: () => void;
}

export function SeriesPage({ onPlay, onClose }: SeriesPageProps) {
  const [selectedSeries, setSelectedSeries] = useState<StoredSeries | null>(null);
  const selectedCategoryId = useSeriesCategory();
  const setSelectedCategoryId = useSetSeriesCategory();
  const [searchQuery, setSearchQuery] = useState('');

  // API key for TMDB
  const tmdbApiKey = useTmdbApiKey();

  // Genres from TMDB
  const { genres } = useTvGenres(tmdbApiKey);

  // Featured content for hero
  const { items: featuredItems } = useFeaturedContent(tmdbApiKey, 'series', 5);

  // Trending and popular from TMDB (if API key available)
  const { series: trendingSeries, loading: trendingLoading } = useTrendingSeries(tmdbApiKey);
  const { series: popularSeries, loading: popularLoading } = usePopularSeries(tmdbApiKey);

  // Fallback: local popularity
  const { series: localPopularSeries } = useLocalPopularSeries(20);

  // Recently added
  const { series: recentSeries, loading: recentLoading } = useRecentSeries(20);

  // VOD categories
  const { categories } = useVodCategories('series');

  // Get selected category name for VodBrowse
  const selectedCategory = categories.find(c => c.category_id === selectedCategoryId);

  // Genre-based list (show first genre if available)
  const firstGenre = genres[0];
  const { series: genreSeries } = useSeriesByGenre(tmdbApiKey, firstGenre?.id ?? null);

  const handleItemClick = useCallback((item: StoredMovie | StoredSeries) => {
    setSelectedSeries(item as StoredSeries);
  }, []);

  const handlePlay = useCallback((url: string, title: string) => {
    if (onPlay) {
      onPlay(url, title);
    }
  }, [onPlay]);

  const handleCloseDetail = useCallback(() => {
    setSelectedSeries(null);
  }, []);

  // Handle search Enter - switch to All tab if on Home
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      if (selectedCategoryId === null) {
        setSelectedCategoryId('all');
      }
    }
  }, [searchQuery, selectedCategoryId, setSelectedCategoryId]);

  // Handle category selection - also close detail view
  const handleCategorySelect = useCallback((id: string | null) => {
    setSelectedCategoryId(id);
    setSelectedSeries(null);
  }, [setSelectedCategoryId]);

  // Handle mouse back button - close detail view
  useEffect(() => {
    const handleMouseBack = (e: MouseEvent) => {
      if (e.button === 3 && selectedSeries) {
        e.preventDefault();
        setSelectedSeries(null);
      }
    };

    const handlePopState = () => {
      if (selectedSeries) {
        setSelectedSeries(null);
      }
    };

    window.addEventListener('mousedown', handleMouseBack);
    window.addEventListener('popstate', handlePopState);

    if (selectedSeries) {
      window.history.pushState({ seriesDetail: true }, '');
    }

    return () => {
      window.removeEventListener('mousedown', handleMouseBack);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [selectedSeries]);

  // Determine which series to show in carousels
  const showTmdbContent = tmdbApiKey && (trendingSeries.length > 0 || popularSeries.length > 0);

  return (
    <div className="series-page">
      {/* Header with search */}
      <header className="series-page__header">
        <button className="series-page__close" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        <h1 className="series-page__title">Series</h1>

        <div className="series-page__search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search series..."
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
      <main className="series-page__content">
        {selectedCategoryId === 'all' ? (
          // All series: Virtualized grid with no filter
          <VodBrowse
            type="series"
            categoryId={null}
            categoryName="All Series"
            search={searchQuery || undefined}
            onItemClick={handleItemClick}
          />
        ) : selectedCategoryId && selectedCategory ? (
          // Category view: Virtualized grid filtered by category
          <VodBrowse
            type="series"
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
              items={featuredItems.length > 0 ? (featuredItems as StoredSeries[]) : localPopularSeries.slice(0, 5)}
              type="series"
              onPlay={(item) => {
                // For series, open detail instead of playing directly
                handleItemClick(item);
              }}
              onMoreInfo={(item) => handleItemClick(item)}
              apiKey={tmdbApiKey}
            />

            {/* Carousels */}
            <div className="series-page__carousels">
              {showTmdbContent ? (
                <>
                  {trendingSeries.length > 0 && (
                    <HorizontalCarousel
                      title="Trending Now"
                      items={trendingSeries}
                      type="series"
                      onItemClick={handleItemClick}
                      loading={trendingLoading}
                    />
                  )}

                  {popularSeries.length > 0 && (
                    <HorizontalCarousel
                      title="Popular"
                      items={popularSeries}
                      type="series"
                      onItemClick={handleItemClick}
                      loading={popularLoading}
                    />
                  )}

                  {firstGenre && genreSeries.length > 0 && (
                    <HorizontalCarousel
                      title={firstGenre.name}
                      items={genreSeries}
                      type="series"
                      onItemClick={handleItemClick}
                    />
                  )}
                </>
              ) : (
                // Fallback without TMDB
                <HorizontalCarousel
                  title="Popular"
                  items={localPopularSeries}
                  type="series"
                  onItemClick={handleItemClick}
                />
              )}

              <HorizontalCarousel
                title="Recently Added"
                items={recentSeries}
                type="series"
                onItemClick={handleItemClick}
                loading={recentLoading}
              />
            </div>
          </>
        )}
      </main>

      {/* Series detail modal */}
      {selectedSeries && (
        <SeriesDetail
          series={selectedSeries}
          onClose={handleCloseDetail}
          onPlayEpisode={handlePlay}
          apiKey={tmdbApiKey}
        />
      )}
    </div>
  );
}

export default SeriesPage;
