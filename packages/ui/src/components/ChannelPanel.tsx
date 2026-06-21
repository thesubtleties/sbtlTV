import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { useChannels, useCategories, useProgramsInRange } from '../hooks/useChannels';
import { useFavoriteChannels } from '../hooks/useFavorites';
import { useTimeGrid } from '../hooks/useTimeGrid';
import { ChannelRow } from './ChannelRow';
import { useChannelSortOrder } from '../stores/uiStore';
import type { StoredChannel } from '../db';
import './ChannelPanel.css';

const DEFAULT_CHANNEL_COLUMN_WIDTH = 320;
const MIN_CHANNEL_COLUMN_WIDTH = 200;
const MAX_CHANNEL_COLUMN_WIDTH = 500;

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
  const [channelColumnWidth, setChannelColumnWidth] = useState(DEFAULT_CHANNEL_COLUMN_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const channelColumnWidthRef = useRef(DEFAULT_CHANNEL_COLUMN_WIDTH);

  // Keep ref in sync for use inside closures
  channelColumnWidthRef.current = channelColumnWidth;

  // Filtered channels by search query
  const displayChannels = useMemo(() => {
    if (!searchQuery.trim()) return channels;
    const q = searchQuery.toLowerCase();
    return channels.filter((ch) => ch.name.toLowerCase().includes(q));
  }, [channels, searchQuery]);

  // Ref for measuring the grid container width
  const gridContainerRef = useRef<HTMLDivElement>(null);
  // Ref to the channel-list Virtuoso for scroll-to-top on active-category re-click
  const channelListRef = useRef<VirtuosoHandle>(null);

  // Scroll the channel list to top when the active category is re-clicked (nonce bump)
  useEffect(() => {
    channelListRef.current?.scrollToIndex({ index: 0 });
  }, [scrollTopNonce]);

  // Scroll to top whenever search changes
  useEffect(() => {
    channelListRef.current?.scrollToIndex({ index: 0 });
  }, [searchQuery]);

  // Track window width to differentiate window resize vs category toggle
  const lastWindowWidth = useRef(typeof window !== 'undefined' ? window.innerWidth : 0);

  // Measure available width - only recalculate on actual window resize
  useEffect(() => {
    const container = gridContainerRef.current;
    if (!container) return;

    let rafId: number | null = null;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      const currentWindowWidth = window.innerWidth;
      const isWindowResize = currentWindowWidth !== lastWindowWidth.current;

      if (isWindowResize) {
        lastWindowWidth.current = currentWindowWidth;

        if (rafId === null) {
          rafId = requestAnimationFrame(() => {
            const width = entry.contentRect.width - channelColumnWidthRef.current;
            setAvailableWidth(Math.max(width, 200));
            rafId = null;
          });
        }
      }
    });

    const handleWindowResize = () => {
      const container = gridContainerRef.current;
      if (!container) return;

      lastWindowWidth.current = window.innerWidth;
      const width = container.getBoundingClientRect().width - channelColumnWidthRef.current;
      setAvailableWidth(Math.max(width, 200));
    };

    const initialWidth = container.getBoundingClientRect().width - channelColumnWidthRef.current;
    setAvailableWidth(Math.max(initialWidth, 200));

    observer.observe(container);
    window.addEventListener('resize', handleWindowResize);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      observer.disconnect();
      window.removeEventListener('resize', handleWindowResize);
    };
  }, []);

  // Recalculate available width when column width changes (drag resize)
  useEffect(() => {
    const container = gridContainerRef.current;
    if (!container) return;
    const width = container.getBoundingClientRect().width - channelColumnWidth;
    setAvailableWidth(Math.max(width, 200));
  }, [channelColumnWidth]);

  // Resize handle drag logic
  const handleResizeMouseDown = useCallback((e: { preventDefault: () => void; clientX: number }) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = channelColumnWidthRef.current;
    setIsResizing(true);

    const onMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      const newWidth = Math.max(
        MIN_CHANNEL_COLUMN_WIDTH,
        Math.min(MAX_CHANNEL_COLUMN_WIDTH, startWidth + delta)
      );
      setChannelColumnWidth(newWidth);
    };

    const onMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

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

  // Get stream IDs for programs lookup (use all channels, not filtered)
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
    const start = new Date(windowStart);
    start.setMinutes(0, 0, 0);

    const hoursToShow = Math.ceil(visibleHours) + 1;
    for (let i = 0; i < hoursToShow; i++) {
      const slot = new Date(start.getTime() + i * 60 * 60 * 1000);
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
      className={`guide-panel ${visible ? 'visible' : 'hidden'} ${categoryStripOpen ? 'with-categories' : ''} ${sidebarExpanded ? 'sidebar-expanded' : ''} ${isResizing ? 'resizing' : ''}`}
    >
      {/* Top Bar - Time Display & Navigation */}
      <div className="guide-header">
        <div className="guide-header-left">
          <span className="guide-current-time">{formatTime(currentTime)}</span>
          <span className="guide-category">{categoryName}</span>
          <span className="guide-channel-count">{channels.length} channels</span>
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
        <div className="guide-time-header-spacer" style={{ width: channelColumnWidth }} />
        <div className="guide-time-header-grid">
          {timeSlots.map((slot, i) => {
            const position = getTimeSlotPosition(slot);
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
        {/* Drag handle for resizing the channel column */}
        <div
          className={`guide-resize-handle ${isResizing ? 'active' : ''}`}
          style={{ left: channelColumnWidth }}
          onMouseDown={handleResizeMouseDown}
          title="Drag to resize channel column"
        />

        <Virtuoso
          ref={channelListRef}
          data={displayChannels}
          className="guide-channels"
          itemContent={(index, channel) => (
            <ChannelRow
              channel={channel}
              index={index}
              sortOrder={channelSortOrder}
              channelColumnWidth={channelColumnWidth}
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
                {searchQuery ? (
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
