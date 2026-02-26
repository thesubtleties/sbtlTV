/**
 * VodBrowse - Virtualized gallery grid with A-Z navigation
 *
 * Shows category-filtered content in a grid with infinite scroll
 * and alphabet quick-nav rail.
 */

import { useState, useCallback, useMemo, useRef, forwardRef, useEffect } from 'react';
import { VirtuosoGrid, VirtuosoGridHandle } from 'react-virtuoso';
import { MediaCard } from './MediaCard';
import { AlphabetRail } from './AlphabetRail';
import { useMovieProgressMap, getMovieProgress } from '../../hooks/useWatchProgress';
import type { StoredMovie, StoredSeries } from '../../db';
import {
  usePaginatedMovies,
  usePaginatedSeries,
  useAlphabetIndex,
  useCurrentLetter,
} from '../../hooks/useVod';
import { useDedupedMovies, useDedupedSeries } from '../../hooks/useVodDedup';
import './VodBrowse.css';

// Debounce hook - delays value updates to avoid expensive operations on every keystroke
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

// Footer component - defined OUTSIDE to prevent remounting on scroll
// Must be stable reference for Virtuoso
const GridFooter = ({ context }: { context?: { loading: boolean } }) => {
  if (!context?.loading) return null;
  return (
    <div className="vod-browse__loading">
      <div className="vod-browse__spinner" />
      <span>Loading more...</span>
    </div>
  );
};

// Custom Scroller - force scrollbar always visible to prevent width recalculation
// See: https://github.com/petyosi/react-virtuoso/issues/1086
const GridScroller = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  (props, ref) => (
    <div
      ref={ref}
      {...props}
      style={{ ...props.style, overflowY: 'scroll' }}
    />
  )
);

// Stable empty arrays to prevent dedup hooks from recalculating every render
const EMPTY_MOVIES: StoredMovie[] = [];
const EMPTY_SERIES: StoredSeries[] = [];

export interface VodBrowseProps {
  type: 'movies' | 'series';
  categoryIds: string[] | null;  // null = all items, array = grouped category IDs
  categoryName: string;
  search?: string;
  onItemClick: (item: StoredMovie | StoredSeries) => void;
}

export function VodBrowse({
  type,
  categoryIds,
  categoryName,
  search,
  onItemClick,
}: VodBrowseProps) {
  const virtuosoRef = useRef<VirtuosoGridHandle>(null);
  const [visibleRange, setVisibleRange] = useState({ startIndex: 0, endIndex: 0 });
  const progressMap = useMovieProgressMap();

  // Debounce search to avoid expensive filtering on every keystroke
  const debouncedSearch = useDebouncedValue(search, 300);

  // Stable key for category changes (scroll to top)
  const categoryKey = categoryIds?.join(',') ?? null;

  // Scroll to top when category changes
  useEffect(() => {
    if (virtuosoRef.current) {
      virtuosoRef.current.scrollToIndex({ index: 0, align: 'start' });
    }
  }, [categoryKey]);

  // Get paginated data (using debounced search)
  const moviesData = usePaginatedMovies(type === 'movies' ? categoryIds : null, debouncedSearch);
  const seriesData = usePaginatedSeries(type === 'series' ? categoryIds : null, debouncedSearch);

  const { items: rawItems, loading, hasMore, loadMore } = type === 'movies' ? moviesData : seriesData;

  // Dedup by tmdb_id — silent, no UI indicator
  const dedupedMovies = useDedupedMovies(type === 'movies' ? (rawItems as StoredMovie[]) : EMPTY_MOVIES);
  const dedupedSeries = useDedupedSeries(type === 'series' ? (rawItems as StoredSeries[]) : EMPTY_SERIES);
  const items = useMemo(
    () => type === 'movies'
      ? dedupedMovies.map(d => d.item)
      : dedupedSeries.map(d => d.item),
    [type, dedupedMovies, dedupedSeries]
  );

  // Alphabet navigation
  const alphabetIndex = useAlphabetIndex(items);
  const currentLetter = useCurrentLetter(items, visibleRange.startIndex);

  // Available letters (ones that have content)
  const availableLetters = useMemo(() => {
    return new Set(alphabetIndex.keys());
  }, [alphabetIndex]);

  // Handle letter selection from rail
  const handleLetterSelect = useCallback((letter: string) => {
    const index = alphabetIndex.get(letter);
    if (index !== undefined && virtuosoRef.current) {
      virtuosoRef.current.scrollToIndex({
        index,
        align: 'start',
        // Instant scroll for letter jumps - smooth would load everything in between
      });
    }
  }, [alphabetIndex]);

  // Handle range change for current letter tracking
  const handleRangeChange = useCallback((range: { startIndex: number; endIndex: number }) => {
    setVisibleRange(range);
  }, []);

  // Handle end reached for infinite scroll
  const handleEndReached = useCallback(() => {
    if (hasMore && !loading) {
      loadMore();
    }
  }, [hasMore, loading, loadMore]);

  // Stable key for each item - receives item from data prop
  const computeItemKey = useCallback(
    (index: number, item: StoredMovie | StoredSeries) => {
      if (!item) return index;
      return type === 'movies'
        ? `movie-${(item as StoredMovie).stream_id}`
        : `series-${(item as StoredSeries).series_id}`;
    },
    [type]
  );

  // Grid item renderer - receives item from data prop, no items dependency
  const ItemContent = useCallback(
    (_index: number, item: StoredMovie | StoredSeries) => {
      if (!item) return null;

      return (
        <MediaCard
          item={item}
          type={type === 'movies' ? 'movie' : 'series'}
          onClick={onItemClick}
          size="medium"
          progress={type === 'movies' ? getMovieProgress(progressMap, item) : undefined}
        />
      );
    },
    [type, onItemClick, progressMap]
  );

  // Empty state
  if (!loading && items.length === 0) {
    return (
      <div className="vod-browse vod-browse--empty">
        <div className="vod-browse__empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <h3>No {type} found</h3>
          <p>
            {search
              ? `No results for "${search}" in ${categoryName}`
              : `No ${type} available in ${categoryName}`}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="vod-browse">
      <VirtuosoGrid
        ref={virtuosoRef}
        className="vod-browse__grid"
        data={items}
        context={{ loading }}
        computeItemKey={computeItemKey}
        itemContent={ItemContent}
        rangeChanged={handleRangeChange}
        endReached={handleEndReached}
        overscan={200}
        listClassName="vod-browse__grid-list"
        itemClassName="vod-browse__grid-item"
        components={{
          Scroller: GridScroller,
          Footer: GridFooter,
        }}
      />

      {items.length > 0 && (
        <AlphabetRail
          currentLetter={currentLetter}
          availableLetters={availableLetters}
          onLetterSelect={handleLetterSelect}
          count={items.length}
        />
      )}
    </div>
  );
}

export default VodBrowse;
