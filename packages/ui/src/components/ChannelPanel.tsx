import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useChannels, useCategories, useProgramsInRange } from '../hooks/useChannels';
import { useTimeGrid } from '../hooks/useTimeGrid';
import { ChannelRow } from './ChannelRow';
import { useChannelSortOrder } from '../stores/uiStore';
import type { StoredChannel } from '../db';
import './ChannelPanel.css';

// Width of the channel info column
const CHANNEL_COLUMN_WIDTH = 280;

interface ChannelPanelProps {
  categoryId: string | null;
  visible: boolean;
  categoryStripOpen: boolean;
  sidebarExpanded: boolean;
  onPlayChannel: (channel: StoredChannel) => void;
  onClose: () => void;
}

export function ChannelPanel({
  categoryId,
  visible,
  categoryStripOpen,
  sidebarExpanded,
  onPlayChannel,
  onClose,
}: ChannelPanelProps) {
  const channelSortOrder = useChannelSortOrder();
  const channels = useChannels(categoryId, channelSortOrder);
  const categories = useCategories();
  const [currentTime, setCurrentTime] = useState(new Date());
  const [availableWidth, setAvailableWidth] = useState(800);

  // Ref for measuring the grid container width
  const gridContainerRef = useRef<HTMLDivElement>(null);

  // Track window width to differentiate window resize vs category toggle
  const lastWindowWidth = useRef(typeof window !== 'undefined' ? window.innerWidth : 0);

  // Measure available width - only recalculate on actual window resize
  // Category toggles just clip visually (CSS flex handles it)
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
        // Actual window resize - recalculate program positions
        lastWindowWidth.current = currentWindowWidth;

        if (rafId === null) {
          rafId = requestAnimationFrame(() => {
            const width = entry.contentRect.width - CHANNEL_COLUMN_WIDTH;
            setAvailableWidth(Math.max(width, 200));
            rafId = null;
          });
        }
      }
      // Category toggle: skip recalculation, CSS flex handles visual clipping
    });

    // Also listen for actual window resize
    const handleWindowResize = () => {
      const container = gridContainerRef.current;
      if (!container) return;

      lastWindowWidth.current = window.innerWidth;
      const width = container.getBoundingClientRect().width - CHANNEL_COLUMN_WIDTH;
      setAvailableWidth(Math.max(width, 200));
    };

    // Set initial width
    const initialWidth = container.getBoundingClientRect().width - CHANNEL_COLUMN_WIDTH;
    setAvailableWidth(Math.max(initialWidth, 200));

    observer.observe(container);
    window.addEventListener('resize', handleWindowResize);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      observer.disconnect();
      window.removeEventListener('resize', handleWindowResize);
    };
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
  const currentCategory = categoryId
    ? categories.find((c) => c.category_id === categoryId)
    : null;
  const categoryName = currentCategory?.category_name ?? 'All Channels';

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
          <span className="guide-channel-count">{channels.length} channels</span>
        </div>
        <div className="guide-header-right">
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
        <div className="guide-time-header-spacer" style={{ width: CHANNEL_COLUMN_WIDTH }} />
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
          data={channels}
          className="guide-channels"
          itemContent={(index, channel) => (
            <ChannelRow
              channel={channel}
              index={index}
              sortOrder={channelSortOrder}
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
                <h3>No Channels</h3>
                <p>Sync your sources to load channels</p>
                <p className="hint">Go to Settings → Add a source → Channels will sync automatically</p>
              </div>
            ),
          }}
        />
      </div>
    </div>
  );
}
