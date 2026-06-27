import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { useChannels, useCategories, useProgramsInRange } from '../hooks/useChannels';
import { useFavoriteChannels } from '../hooks/useFavorites';
import { useTimeGrid } from '../hooks/useTimeGrid';
import { ChannelRow } from './ChannelRow';
import { useChannelSortOrder, useChannelColumnWidth } from '../stores/uiStore';
import type { StoredChannel } from '../db';
import { filterChannelsByName } from '../utils/channelFilter';
import './ChannelPanel.css';

interface ChannelPanelProps {
  categoryId: string | null;
  visible: boolean;
  categoryStripOpen: boolean;
  sidebarExpanded: boolean;
  onPlayChannel: (channel: StoredChannel) => void;
  onClose: () => void;
  scrollTopNonce?: number;
}

export function ChannelPanel({
  categoryId,
  visible,
  categoryStripOpen,
  sidebarExpanded,
  onPlayChannel,
  onClose,
  scrollTopNonce,
}: ChannelPanelProps) {
  const channelSortOrder = useChannelSortOrder();
  const isFavoritesView = categoryId === '__favorites__';
  const regularChannels = useChannels(isFavoritesView ? null : categoryId, channelSortOrder);
  const favoriteChannels = useFavoriteChannels();
  const channels = isFavoritesView ? favoriteChannels : regularChannels;
  const categories = useCategories();
  const [currentTime, setCurrentTime] = useState(new Date());
  const [availableWidth, setAvailableWidth] = useState(800);
  const [searchQuery, setSearchQuery] = useState('');

  // Channels filtered by the in-guide search box; the FULL list still drives EPG/program lookups.
  const displayChannels = useMemo(() => filterChannelsByName(channels, searchQuery), [channels, searchQuery]);

  // Channel column width is a persisted setting; the EFFECTIVE width yields a bit on narrow
  // windows so the EPG grid never drops below 200px. The ref lets the mount-once ResizeObserver
  // / resize listener read the live setting value instead of a stale closure.
  const channelColumnWidth = useChannelColumnWidth();
  const channelColumnWidthRef = useRef(channelColumnWidth);
  channelColumnWidthRef.current = channelColumnWidth;
  const [effectiveColumnWidth, setEffectiveColumnWidth] = useState(channelColumnWidth);

  // Ref for measuring the grid container width
  const gridContainerRef = useRef<HTMLDivElement>(null);
  // Ref to the channel-list Virtuoso for scroll-to-top on active-category re-click
  const channelListRef = useRef<VirtuosoHandle>(null);

  // Scroll the channel list to top when the active category is re-clicked (nonce bump)
  useEffect(() => {
    channelListRef.current?.scrollToIndex({ index: 0 });
  }, [scrollTopNonce]);

  // Scroll the channel list to top whenever the search query changes.
  useEffect(() => {
    channelListRef.current?.scrollToIndex({ index: 0 });
  }, [searchQuery]);

  // Clear the search when switching categories - the search is scoped to the current category,
  // so a leftover query would filter the new category against the wrong term. useLayoutEffect so
  // the clear lands before paint (no one-frame flash of the new category filtered by the old query).
  useLayoutEffect(() => {
    setSearchQuery('');
  }, [categoryId]);

  // Track window width to differentiate window resize vs category toggle
  const lastWindowWidth = useRef(typeof window !== 'undefined' ? window.innerWidth : 0);

  // Recompute the effective column width + remaining grid width from the live container size.
  // effective = min(setting, container - 200) so a narrow window lets the column yield rather
  // than starving the EPG; availableWidth = container - effective (floored at 200).
  const measureWidths = useCallback(() => {
    const container = gridContainerRef.current;
    if (!container) return;
    const containerWidth = container.getBoundingClientRect().width;
    const effective = Math.min(channelColumnWidthRef.current, Math.max(0, containerWidth - 200));
    setEffectiveColumnWidth(effective);
    setAvailableWidth(Math.max(containerWidth - effective, 200));
  }, []);

  // Measure on actual window resize only (category toggles just clip visually - CSS flex handles it).
  useEffect(() => {
    const container = gridContainerRef.current;
    if (!container) return;

    let rafId: number | null = null;

    const observer = new ResizeObserver(() => {
      const currentWindowWidth = window.innerWidth;
      const isWindowResize = currentWindowWidth !== lastWindowWidth.current;
      if (isWindowResize) {
        lastWindowWidth.current = currentWindowWidth;
        if (rafId === null) {
          rafId = requestAnimationFrame(() => {
            measureWidths();
            rafId = null;
          });
        }
      }
      // Category toggle: skip recalculation, CSS flex handles visual clipping
    });

    const handleWindowResize = () => {
      lastWindowWidth.current = window.innerWidth;
      measureWidths();
    };

    measureWidths(); // initial

    observer.observe(container);
    window.addEventListener('resize', handleWindowResize);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      observer.disconnect();
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [measureWidths]);

  // Recompute when the channel column width setting (slider) changes.
  useEffect(() => {
    measureWidths();
  }, [channelColumnWidth, measureWidths]);

  // Time grid state and actions
  const {
    isAtNow,
    visibleHours,
    pixelsPerHour,
    windowStart,
    windowEnd,
    loadStart,
    loadEnd,
    goBack,
    goForward,
    goToNow,
  } = useTimeGrid({ availableWidth });

  // Get stream IDs for programs lookup
  const streamIds = useMemo(() => channels.map((ch) => ch.stream_id), [channels]);

  // Fetch programs for the preload window
  const programs = useProgramsInRange(streamIds, loadStart, loadEnd);

  // Update current time every minute
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goBack();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goForward();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visible, goBack, goForward]);

  // Get current category name
  const currentCategory = categoryId && !isFavoritesView
    ? categories.find((c) => c.category_id === categoryId)
    : null;
  const categoryName = isFavoritesView
    ? 'Favorites'
    : currentCategory?.category_name ?? 'All Channels';

  // Format time
  const formatTime = useCallback((date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, []);

  // Generate time slots aligned to the grid
  const timeSlots = useMemo(() => {
    const slots: Date[] = [];
    // Start from the hour at or before windowStart
    const start = new Date(windowStart);
    start.setMinutes(0, 0, 0);

    // Generate slots for each hour in the visible window
    const hoursToShow = Math.ceil(visibleHours) + 1;
    for (let i = 0; i < hoursToShow; i++) {
      const slot = new Date(start.getTime() + i * 60 * 60 * 1000);
      // Only include if it falls within or slightly before the visible window
      if (slot.getTime() <= windowEnd.getTime()) {
        slots.push(slot);
      }
    }

    return slots;
  }, [windowStart, windowEnd, visibleHours]);

  // Calculate position of a time slot within the grid
  const getTimeSlotPosition = useCallback(
    (slotTime: Date) => {
      const offsetHours = (slotTime.getTime() - windowStart.getTime()) / 3600000;
      return offsetHours * pixelsPerHour;
    },
    [windowStart, pixelsPerHour]
  );

  return (
    <div
      ref={gridContainerRef}
      className={`guide-panel ${visible ? 'visible' : 'hidden'} ${categoryStripOpen ? 'with-categories' : ''} ${sidebarExpanded ? 'sidebar-expanded' : ''}`}
    >
      {/* Top Bar - Time Display & Navigation */}
      <div className="guide-header">
        <div className="guide-header-left">
          <span className="guide-current-time">{formatTime(currentTime)}</span>
          <span className="guide-category">{categoryName}</span>
          <span className="guide-channel-count">
            {searchQuery.trim() ? `${displayChannels.length} of ${channels.length}` : `${channels.length} channels`}
          </span>
        </div>
        <div className="guide-header-right">
          {/* Channel search */}
          <div className="guide-search-wrapper">
            <svg className="guide-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              className="guide-search-input"
              type="text"
              placeholder="Search channels…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && searchQuery) {
                  setSearchQuery('');
                  e.stopPropagation();
                }
              }}
            />
            {searchQuery && (
              <button
                className="guide-search-clear"
                onClick={() => setSearchQuery('')}
                title="Clear search"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Navigation controls */}
          <div className="guide-nav">
            <button className="guide-nav-btn" onClick={goBack} title="Previous hour (←)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <button
              className={`guide-now-btn ${isAtNow ? 'inactive' : ''}`}
              onClick={goToNow}
              disabled={isAtNow}
              title="Go to now"
            >
              Now
            </button>
            <button className="guide-nav-btn" onClick={goForward} title="Next hour (→)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </div>

          <button className="guide-close" onClick={onClose} title="Close (Esc)">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Time Header - Aligned to grid */}
      <div className="guide-time-header">
        <div className="guide-time-header-spacer" style={{ width: effectiveColumnWidth }} />
        <div className="guide-time-header-grid">
          {timeSlots.map((slot, i) => {
            const position = getTimeSlotPosition(slot);
            // Hide if marker would be cut off at left edge or beyond right edge
            if (position < 0 || position > availableWidth) return null;
            return (
              <span
                key={i}
                className="guide-time-marker"
                style={{ left: position }}
              >
                {formatTime(slot)}
              </span>
            );
          })}
        </div>
      </div>

      {/* EPG Grid Area */}
      <div className="guide-content">
        <Virtuoso
          ref={channelListRef}
          data={displayChannels}
          computeItemKey={(_, channel) => channel.stream_id}
          className="guide-channels"
          itemContent={(index, channel) => (
            <ChannelRow
              channel={channel}
              index={index}
              sortOrder={channelSortOrder}
              channelColumnWidth={effectiveColumnWidth}
              programs={programs.get(channel.stream_id) ?? []}
              windowStart={windowStart}
              windowEnd={windowEnd}
              pixelsPerHour={pixelsPerHour}
              visibleHours={visibleHours}
              onPlay={() => onPlayChannel(channel)}
            />
          )}
          components={{
            EmptyPlaceholder: () => (
              <div className="guide-empty">
                <div className="guide-empty-icon">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="2" y="7" width="20" height="13" rx="2" />
                    <path d="M17 2l-5 5-5-5" />
                  </svg>
                </div>
                {searchQuery.trim() ? (
                  <>
                    <h3>No results for "{searchQuery}"</h3>
                    <p>Try a different search term</p>
                  </>
                ) : (
                  <>
                    <h3>No Channels</h3>
                    <p>Sync your sources to load channels</p>
                    <p className="hint">Go to Settings → Add a source → Channels will sync automatically</p>
                  </>
                )}
              </div>
            ),
          }}
        />
      </div>
    </div>
  );
}
