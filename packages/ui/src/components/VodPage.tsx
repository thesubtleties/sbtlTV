import { useState, useCallback, useEffect, useMemo } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { HeroSection } from './vod/HeroSection';
import { HorizontalCarousel } from './vod/HorizontalCarousel';
import { HorizontalCategoryStrip } from './vod/HorizontalCategoryStrip';
import { VodBrowse } from './vod/VodBrowse';
import { MovieDetail } from './vod/MovieDetail';
import { SeriesDetail } from './vod/SeriesDetail';
import { useVodHomeData } from '../hooks/useVodHomeData';
import { useVodNavigation } from '../stores/uiStore';
import type { StoredMovie, StoredSeries } from '../db';
import { type MediaItem, type VodType, type VodPlayInfo } from '../types/media';
import './VodPage.css';

// Animation timing (must match .vod-page transition in VodPage.css: 0.35s)
const SLIDE_DURATION_MS = 350;
const SLIDE_DELAY_MS = 50;

// Carousel row type for virtualization (all data pre-fetched)
type CarouselRow = {
  key: string;
  title: string;
  items: MediaItem[];
  loading?: boolean;
};

// Context passed to Virtuoso components (must be defined outside render)
interface HomeVirtuosoContext {
  type: VodType;
  tmdbApiKey: string | null;
  featuredItems: MediaItem[];
  localPopularItems: MediaItem[];
  heroLoading: boolean;
  onItemClick: (item: MediaItem) => void;
  onHeroPlay: (item: MediaItem) => void;
  progressMap?: Map<string, number>;
}

// Header component for Virtuoso (defined outside render to prevent remounting)
const HomeHeader: React.ComponentType<{ context?: HomeVirtuosoContext }> = ({ context }) => {
  if (!context) return null;
  const { featuredItems, localPopularItems, type, onHeroPlay, onItemClick, tmdbApiKey, heroLoading } = context;
  return (
    <HeroSection
      items={featuredItems.length > 0 ? featuredItems : localPopularItems.slice(0, 5)}
      type={type}
      onPlay={onHeroPlay}
      onMoreInfo={onItemClick}
      apiKey={tmdbApiKey}
      loading={heroLoading}
    />
  );
};

// Item renderer for Virtuoso (defined outside render)
// All data is pre-fetched, so this just renders the carousel
const CarouselRowContent = (
  _index: number,
  row: CarouselRow,
  context: HomeVirtuosoContext | undefined
) => {
  if (!context) return null;
  const { type, onItemClick, progressMap } = context;

  return (
    <HorizontalCarousel
      title={row.title}
      items={row.items}
      type={type}
      onItemClick={onItemClick}
      loading={row.loading}
      progressMap={type === 'movie' ? progressMap : undefined}
    />
  );
};

// Stable components object for Virtuoso
const homeVirtuosoComponents = {
  Header: HomeHeader,
};

// Animation state machine for VodPage enter/exit/collapse transitions
function useVodPageAnimation(
  selectedItem: MediaItem | null,
  setSelectedItem: (item: MediaItem | null) => void,
  setPageCollapsed: (collapsed: boolean) => void,
  onClose?: () => void,
) {
  // Start hidden if we have a detail (will show after detail slides up)
  const [pageContentVisible, setPageContentVisible] = useState(!selectedItem);
  // Always start collapsed, animate up
  const [isEntering, setIsEntering] = useState(true);

  // Animate in on mount
  useEffect(() => {
    if (selectedItem) {
      // Has detail: detail slides up, then page content pops in after
      const startTimer = setTimeout(() => {
        setIsEntering(false);
        setPageCollapsed(false);
      }, SLIDE_DELAY_MS);
      const showContentTimer = setTimeout(() => {
        setPageContentVisible(true);
      }, SLIDE_DELAY_MS + SLIDE_DURATION_MS);
      return () => {
        clearTimeout(startTimer);
        clearTimeout(showContentTimer);
      };
    } else {
      // No detail: slide whole page up
      setPageContentVisible(true);
      const timer = setTimeout(() => {
        setIsEntering(false);
        setPageCollapsed(false);
      }, SLIDE_DELAY_MS);
      return () => clearTimeout(timer);
    }
  }, []); // Only on mount

  // Collapse handler from detail - hides background content instantly, slides detail down
  const handleCollapsePage = useCallback(() => {
    setPageContentVisible(false);
    setPageCollapsed(true);
    setTimeout(() => {
      onClose?.();
    }, SLIDE_DURATION_MS);
  }, [setPageCollapsed, onClose]);

  // Back handler - close detail if open, otherwise slide page down
  const handlePageBack = useCallback(() => {
    if (selectedItem) {
      setSelectedItem(null);
    } else {
      setPageCollapsed(true);
      setTimeout(() => {
        onClose?.();
      }, SLIDE_DURATION_MS);
    }
  }, [selectedItem, setSelectedItem, setPageCollapsed, onClose]);

  return { isEntering, pageContentVisible, handleCollapsePage, handlePageBack };
}

interface VodPageProps {
  type: VodType;
  onPlay?: (info: VodPlayInfo) => void;
  onClose?: () => void;
}

export function VodPage({ type, onPlay, onClose }: VodPageProps) {
  // Navigation state from store (persists per media type across tab switches)
  const {
    selectedCategoryId, setSelectedCategoryId,
    searchQuery, setSearchQuery,
    scrollPosition, setScrollPosition,
    detailItem, setDetailItem: setDetailItemStore,
    isPageCollapsed, setPageCollapsed,
  } = useVodNavigation(type);

  // Local selected item state, initialized from store
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(detailItem);

  // Sync selected item back to store
  useEffect(() => {
    setDetailItemStore(selectedItem);
  }, [selectedItem, setDetailItemStore]);

  // Animation state machine (enter/exit/collapse transitions)
  const { isEntering, pageContentVisible, handleCollapsePage, handlePageBack } =
    useVodPageAnimation(selectedItem, setSelectedItem, setPageCollapsed, onClose);

  // All home view data (TMDB lists, watchlist, categories, genres)
  const {
    tmdbApiKey, featuredItems,
    trendingItems, trendingLoading,
    popularItems, popularLoading,
    topRatedItems, topRatedLoading,
    nowOrOnAirItems, nowOrOnAirLoading,
    watchlistItems, movieProgressMap,
    localPopularItems, groupedCategories,
    genresToShow, genreData,
  } = useVodHomeData(type);

  // Resolve selected groupKey back to category IDs for VodBrowse
  const selectedGroup = groupedCategories.find(g => g.groupKey === selectedCategoryId);
  const selectedCategoryIds = selectedGroup?.categoryIds ?? null;

  // Build carousel rows for virtualization
  // Only includes rows that have content (or are loading)
  const carouselRows = useMemo((): CarouselRow[] => {
    const rows: CarouselRow[] = [];

    // Watchlist (top of home, only when non-empty)
    if (watchlistItems.length > 0) {
      rows.push({
        key: 'watchlist',
        title: 'My Watchlist',
        items: watchlistItems,
      });
    }

    // Trending
    if (trendingItems.length > 0 || trendingLoading) {
      rows.push({
        key: 'trending',
        title: 'Trending Now',
        items: trendingItems,
        loading: trendingLoading,
      });
    }

    // Popular
    if (popularItems.length > 0 || popularLoading) {
      rows.push({
        key: 'popular',
        title: 'Popular',
        items: popularItems,
        loading: popularLoading,
      });
    }

    // Top Rated
    if (topRatedItems.length > 0 || topRatedLoading) {
      rows.push({
        key: 'top-rated',
        title: 'Top Rated',
        items: topRatedItems,
        loading: topRatedLoading,
      });
    }

    // Now Playing / On The Air
    if (nowOrOnAirItems.length > 0 || nowOrOnAirLoading) {
      rows.push({
        key: 'now-or-onair',
        title: type === 'movie' ? 'Now Playing' : 'On The Air',
        items: nowOrOnAirItems,
        loading: nowOrOnAirLoading,
      });
    }

    // Genre carousels - use pre-fetched data (only if has content or still loading)
    for (const genre of genresToShow) {
      const data = genreData.get(genre.id);
      const items = data?.items || [];
      const loading = data?.loading ?? true;
      // Only add row if it has content or is still loading
      if (items.length > 0 || loading) {
        rows.push({
          key: `genre-${genre.id}`,
          title: genre.name,
          items,
          loading,
        });
      }
    }

    return rows;
  }, [
    watchlistItems,
    trendingItems, trendingLoading,
    popularItems, popularLoading,
    topRatedItems, topRatedLoading,
    nowOrOnAirItems, nowOrOnAirLoading,
    genresToShow, genreData,
    type,
  ]);

  const handleItemClick = useCallback((item: MediaItem) => {
    setSelectedItem(item);
  }, []);

  const handlePlay = useCallback((info: VodPlayInfo) => {
    if (onPlay) {
      // Trigger slide-down animation
      setPageCollapsed(true);
      // Delay playback until animation completes
      setTimeout(() => {
        onPlay(info);
      }, SLIDE_DURATION_MS);
    }
  }, [onPlay, setPageCollapsed]);

  const handleCloseDetail = useCallback(() => {
    setSelectedItem(null);
  }, []);

  // Handle hero play button - movies play directly, series open detail
  const handleHeroPlay = useCallback((item: MediaItem) => {
    if (type === 'movie') {
      const movie = item as StoredMovie;
      handlePlay({
        url: movie.direct_url,
        title: movie.title || movie.name,
        year: movie.year || movie.release_date?.slice(0, 4),
        plot: movie.plot,
        type: 'movie',
        streamId: movie.stream_id,
        tmdbId: movie.tmdb_id,
        sourceId: movie.source_id,
      });
    } else {
      setSelectedItem(item);
    }
  }, [type, handlePlay]);

  // Hero is loading if we have no items AND data is still being fetched
  const heroLoading = featuredItems.length === 0 &&
    localPopularItems.length === 0 &&
    (trendingLoading || popularLoading);

  // Memoized context for Virtuoso to prevent unnecessary re-renders
  const homeVirtuosoContext = useMemo((): HomeVirtuosoContext => ({
    type,
    tmdbApiKey,
    featuredItems,
    localPopularItems,
    heroLoading,
    onItemClick: handleItemClick,
    onHeroPlay: handleHeroPlay,
    progressMap: type === 'movie' ? movieProgressMap : undefined,
  }), [type, tmdbApiKey, featuredItems, localPopularItems, heroLoading, handleItemClick, handleHeroPlay, movieProgressMap]);

  // Handle category selection - also close detail view
  const handleCategorySelect = useCallback((id: string | null) => {
    setSelectedCategoryId(id);
    setSelectedItem(null);
  }, [setSelectedCategoryId]);

  // Handle mouse back button and browser back - close detail view
  useEffect(() => {
    const handleMouseBack = (e: MouseEvent) => {
      if (e.button === 3 && selectedItem) {
        e.preventDefault();
        setSelectedItem(null);
      }
    };

    const handlePopState = () => {
      if (selectedItem) {
        setSelectedItem(null);
      }
    };

    window.addEventListener('mousedown', handleMouseBack);
    window.addEventListener('popstate', handlePopState);

    // Push state when opening detail so back button works
    if (selectedItem) {
      window.history.pushState({ vodDetail: true }, '');
    }

    return () => {
      window.removeEventListener('mousedown', handleMouseBack);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [selectedItem]);

  // Labels
  const typeLabel = type === 'movie' ? 'Movies' : 'Series';
  const browseType = type === 'movie' ? 'movies' : 'series';

  // Determine animation mode: page-level (no detail) vs detail-level (has detail)
  const hasDetail = !!selectedItem;
  const shouldPageBeCollapsed = (isEntering || isPageCollapsed) && !hasDetail;
  const pageClasses = [
    'vod-page',
    // Animate whole page when entering/exiting without detail
    shouldPageBeCollapsed ? 'vod-page--collapsed' : '',
    // Hide page content when detail is animating out
    !pageContentVisible ? 'vod-page--content-hidden' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={pageClasses}>
      {/* Unified header: back + categories + search */}
      <HorizontalCategoryStrip
        categories={groupedCategories.map(g => ({ id: g.groupKey, name: g.name }))}
        selectedId={selectedCategoryId}
        onSelect={handleCategorySelect}
        type={type}
        onBack={handlePageBack}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onSearchSubmit={() => {
          if (searchQuery.trim() && selectedCategoryId === null) {
            setSelectedCategoryId('all');
          }
        }}
      />

      {/* Main content */}
      <main className="vod-page__content">
        {selectedCategoryId === 'all' ? (
          // All items: Virtualized grid with no filter
          <VodBrowse
            type={browseType}
            categoryIds={null}
            categoryName={`All ${typeLabel}`}
            search={searchQuery || undefined}
            onItemClick={handleItemClick}
          />
        ) : selectedCategoryId && selectedGroup ? (
          // Category view: Virtualized grid filtered by grouped category IDs
          <VodBrowse
            type={browseType}
            categoryIds={selectedCategoryIds}
            categoryName={selectedGroup.name}
            search={searchQuery || undefined}
            onItemClick={handleItemClick}
          />
        ) : (
          // Home view: Hero + virtualized carousels
          <Virtuoso
            className="vod-page__home"
            data={carouselRows}
            context={homeVirtuosoContext}
            overscan={200}
            fixedItemHeight={386}
            computeItemKey={(_, row) => row.key}
            components={homeVirtuosoComponents}
            itemContent={CarouselRowContent}
            initialScrollTop={scrollPosition}
            onScroll={(e) => {
              // Only track scroll on home view
              if (selectedCategoryId === null) {
                setScrollPosition((e.target as HTMLElement).scrollTop);
              }
            }}
          />
        )}
      </main>

      {/* Detail modal */}
      {selectedItem && type === 'movie' && (
        <MovieDetail
          movie={selectedItem as StoredMovie}
          onClose={handleCloseDetail}
          onCollapse={handleCollapsePage}
          isCollapsed={isEntering || isPageCollapsed}
          onPlay={(movie, plot) => handlePlay({
            url: movie.direct_url,
            title: movie.title || movie.name,
            year: movie.year || movie.release_date?.slice(0, 4),
            plot: plot || movie.plot,
            type: 'movie',
            streamId: movie.stream_id,
            tmdbId: movie.tmdb_id,
            sourceId: movie.source_id,
          })}
          apiKey={tmdbApiKey}
        />
      )}
      {selectedItem && type === 'series' && (
        <SeriesDetail
          series={selectedItem as StoredSeries}
          onClose={handleCloseDetail}
          onCollapse={handleCollapsePage}
          isCollapsed={isEntering || isPageCollapsed}
          onPlayEpisode={handlePlay}
          apiKey={tmdbApiKey}
        />
      )}
    </div>
  );
}

export default VodPage;
