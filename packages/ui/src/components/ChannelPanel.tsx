import { memo, useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { useChannels, useCategories, useProgramsInRange } from '../hooks/useChannels';
import { useFavoriteChannels } from '../hooks/useFavorites';
import { useTimeGrid } from '../hooks/useTimeGrid';
import { useGuideRowRange } from '../hooks/useGuideRowRange';
import { ChannelRow } from './ChannelRow';
import { useChannelSortOrder, useChannelColumnWidth, useSourceNeedsLogin } from '../stores/uiStore';
import type { StoredChannel } from '../db';
import { filterChannelsByName } from '../utils/channelFilter';
import { loadGuideSearchMode, saveGuideSearchMode, type GuideSearchMode } from '../utils/guideSearchMode';
import { isAiringLive, type GuideAiring, type GuideSearchChannel } from '@sbtltv/core';
import { data } from '../data/client';
import { useGuideSearch } from '../hooks/useGuideSearch';
import { GuideHighlight, GuideSearchResults, flattenResults, type GuideItem } from './GuideSearchResults';
import { useToastStore } from '../stores/toastStore';
import { debugLog } from '../utils/debugLog';
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

function ChannelPanelImpl({
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
  const waitingForLogin = useSourceNeedsLogin();
  const [availableWidth, setAvailableWidth] = useState(800);
  const [searchQuery, setSearchQuery] = useState('');

  const [searchMode, setSearchMode] = useState<GuideSearchMode>(loadGuideSearchMode);
  const [dropdownOpen, setDropdownOpen] = useState(true);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [allChannels, setAllChannels] = useState(false);
  const [jump, setJump] = useState<{ title: string; when: string; rows: StoredChannel[]; ids: Set<string> } | null>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  useEffect(() => { setActiveIndex(-1); setAllChannels(false); setExpandedKey(null); }, [searchQuery]);
  // Until the data process has opened the file, an empty guide means "not yet", not "no channels"
  const [dataReady, setDataReady] = useState(false);
  useEffect(() => { void data.ready.then(() => setDataReady(true)); }, []);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!searchBoxRef.current?.contains(e.target as Node)) setDropdownOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const swapSearchMode = () => {
    const next = searchMode === 'search' ? 'filter' : 'search';
    setSearchMode(next);
    saveGuideSearchMode(next);
    setDropdownOpen(true);
    searchInputRef.current?.focus();
  };

  // Channels shown in the guide: Filter mode narrows the open category, a jump shows one airing's channels.
  // This is the list Virtuoso renders, so the program query below is sliced from it by row index.
  const displayChannels = useMemo(() => {
    if (jump) return jump.rows;
    return searchMode === 'filter' ? filterChannelsByName(channels, searchQuery) : channels;
  }, [channels, jump, searchMode, searchQuery]);

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

  // Scroll the channel list to top whenever the filter or the category changes (Search mode
  // leaves the guide where it is). The list used to empty for a frame between categories, which
  // reset the scroll on its own; the data client keeps the previous rows on screen while the
  // next category loads, so the reset is explicit now.
  const filterText = searchMode === 'filter' ? searchQuery : '';
  useEffect(() => {
    channelListRef.current?.scrollToIndex({ index: 0 });
  }, [filterText, categoryId]);

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
    now,
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
    goTo,
  } = useTimeGrid({ availableWidth });

  const { results, pending, failed } = useGuideSearch(searchQuery, searchMode === 'search', now.getTime());
  const items = useMemo(() => (results ? flattenResults(results, allChannels, expandedKey) : []), [results, allChannels, expandedKey]);
  const activeId = items[activeIndex]?.id ?? null;

  // However a jump ends, the guide goes back to now: it never shows Thursday as if it were today
  const endJump = useCallback(() => { setJump(null); goToNow(); }, [goToNow]);
  const jumping = jump !== null;
  useEffect(() => { if (jumping) endJump(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [categoryId]);
  useEffect(() => { if (!visible && jumping) endJump(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [visible]);

  const pickFailed = (what: string, e: unknown) => {
    debugLog(`Guide search: ${what} failed: ${e instanceof Error ? e.message : String(e)}`, 'app');
    useToastStore.getState().addToast({ kind: 'error', title: "Couldn't open that", message: 'Details are in the debug log.', duration: 5000 });
  };
  const gone = () => useToastStore.getState().addToast({ kind: 'info', title: 'No longer available', message: 'That channel is gone from your sources.', duration: 4000 });
  // A pick hands the keyboard back to the guide and the player
  const leaveBox = () => { setSearchQuery(''); searchInputRef.current?.blur(); };

  const playStream = useCallback(async (streamId: string) => {
    try {
      const [channel] = await data.query({ type: 'channelsByIds', streamIds: [streamId] });
      if (!channel) { gone(); return; }
      leaveBox();
      onPlayChannel(channel as unknown as StoredChannel);
    } catch (e) { pickFailed('play', e); }
  }, [onPlayChannel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Later: the guide goes to that time, showing only this airing's channels
  const jumpTo = useCallback(async (airing: GuideAiring, streamIds: string[]) => {
    try {
      const rows = await data.query({ type: 'channelsByIds', streamIds });
      if (rows.length === 0) { gone(); return; }
      const start = new Date(airing.startMs);
      start.setMinutes(start.getMinutes() < 30 ? 0 : 30, 0, 0);
      goTo(start);
      const when = new Date(airing.startMs);
      setJump({
        title: airing.title,
        when: `${when.toLocaleDateString([], { weekday: 'short' })} ${when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`,
        rows: rows as unknown as StoredChannel[],
        ids: new Set(airing.programIds),
      });
      leaveBox();
    } catch (e) { pickFailed('jump', e); }
  }, [goTo]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleFeeds = (key: string) => setExpandedKey((k) => (k === key ? null : key));
  // Live is decided at the click: a Later row may have started while the dropdown was open
  const pickAiring = (a: GuideAiring) => {
    if (!isAiringLive(a, Date.now())) void jumpTo(a, a.channels.map((c) => c.stream_id));
    else if (a.channels[0]) void playStream(a.channels[0].stream_id);
  };
  const pickFeed = (a: GuideAiring, c: GuideSearchChannel) => {
    if (isAiringLive(a, Date.now())) void playStream(c.stream_id); else void jumpTo(a, [c.stream_id]);
  };
  const pickItem = (item: GuideItem) => {
    if (item.kind === 'channel') void playStream(item.channel.stream_id);
    else if (item.kind === 'more') setAllChannels(true);
    else if (item.kind === 'feed') pickFeed(item.airing, item.channel);
    else if (isAiringLive(item.airing, Date.now()) && item.airing.channels.length > 1) toggleFeeds(item.airing.key);
    else pickAiring(item.airing);
  };

  // Programs are read only for the rows Virtuoso is rendering (see useGuideRowRange).
  const { handleRangeChange, loadedStreamIds } = useGuideRowRange(displayChannels);
  const programs = useProgramsInRange(loadedStreamIds, loadStart, loadEnd);

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
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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
          <span className="guide-current-time">{formatTime(now)}</span>
          <span className="guide-category">{categoryName}</span>
          <span className="guide-channel-count">
            {jump || (searchMode === 'filter' && searchQuery.trim()) ? `${displayChannels.length} of ${channels.length}` : `${channels.length} channels`}
          </span>
        </div>
        <div className="guide-header-right">
          {/* Channel search */}
          <div className="guide-search-wrapper" ref={searchBoxRef}>
            <button
              type="button"
              className="guide-search-mode"
              onClick={swapSearchMode}
              title={searchMode === 'search' ? 'Filter this category instead' : 'Search channels and shows instead'}
              aria-label={searchMode === 'search' ? 'Switch to filtering this category' : 'Switch to searching channels and shows'}
            >
              {searchMode === 'search' ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <path d="M21 21l-4.35-4.35" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 5h18l-7 8v6l-4 2v-8z" />
                </svg>
              )}
            </button>
            <input
              ref={searchInputRef}
              className="guide-search-input"
              type="text"
              placeholder={searchMode === 'search' ? 'Search channels and shows…' : 'Filter channels…'}
              value={searchQuery}
              onFocus={() => setDropdownOpen(true)}
              onChange={(e) => { setSearchQuery(e.target.value); setDropdownOpen(true); if (jump) endJump(); }}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  if (searchQuery) { setSearchQuery(''); return; }
                  e.currentTarget.blur();
                  onClose();
                } else if (searchMode === 'search' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                  e.preventDefault();
                  e.stopPropagation();
                  setActiveIndex((i) => Math.max(-1, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))));
                } else if (searchMode === 'search' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
                  // Right and Left open and close a row's feeds; otherwise they stay the caret's
                  const item = items[activeIndex];
                  if (item?.kind !== 'airing' || item.airing.channels.length < 2) return;
                  e.preventDefault();
                  setExpandedKey(e.key === 'ArrowRight' ? item.airing.key : null);
                } else if (searchMode === 'search' && e.key === 'Enter') {
                  // Never on results for what was typed a moment ago
                  if (pending) return;
                  const item = items[activeIndex] ?? items[0];
                  if (item) pickItem(item);
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
            {searchMode === 'search' && (results || failed) && searchQuery.trim() && dropdownOpen && (
              <div className="gsr-panel" style={{ maxWidth: Math.max(240, availableWidth + effectiveColumnWidth - 215) }} onMouseDown={(e) => e.preventDefault()}>
                {failed && <div className="gsr-empty">Search didn't work. Details are in the debug log.</div>}
                {results && !failed && (
                  <GuideSearchResults
                    results={results}
                    query={searchQuery}
                    activeId={activeId}
                    allChannels={allChannels}
                    expandedKey={expandedKey}
                    onShowAllChannels={() => setAllChannels(true)}
                    onToggleFeeds={toggleFeeds}
                    onPickAiring={pickAiring}
                    onPickFeed={pickFeed}
                    onPickChannel={(c) => void playStream(c.stream_id)}
                  />
                )}
              </div>
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
              onClick={jump ? endJump : goToNow}
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

      {jump && (
        <div className="gsr-strip">
          <span><strong>{jump.title}</strong> · {jump.when} · {jump.rows.length === 1 ? jump.rows[0].name : `${jump.rows.length} channels`}</span>
          <button onClick={endJump}>Back to guide</button>
        </div>
      )}

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
        <GuideHighlight.Provider value={jump?.ids ?? null}>
        <Virtuoso
          ref={channelListRef}
          data={displayChannels}
          rangeChanged={handleRangeChange}
          computeItemKey={(_, channel) => channel.stream_id}
          className="guide-channels"
          itemContent={(index, channel) => (
            <ChannelRow
              channel={channel}
              index={index}
              sortOrder={channelSortOrder}
              channelColumnWidth={effectiveColumnWidth}
              programs={programs.get(channel.stream_id)}
              windowStart={windowStart}
              windowEnd={windowEnd}
              now={now}
              pixelsPerHour={pixelsPerHour}
              visibleHours={visibleHours}
              onPlay={onPlayChannel}
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
                {!dataReady ? (
                  <h3>Loading the guide…</h3>
                ) : filterText.trim() ? (
                  <>
                    <h3>No results for "{searchQuery}"</h3>
                    <p>Try a different search term</p>
                  </>
                ) : (
                  <>
                    <h3>No Channels</h3>
                    {waitingForLogin ? (
                      <p className="hint">A source needs its password before its channels can load: Settings → Sources</p>
                    ) : (
                      <>
                        <p>Sync your sources to load channels</p>
                        <p className="hint">Go to Settings → Add a source → Channels will sync automatically</p>
                      </>
                    )}
                  </>
                )}
              </div>
            ),
          }}
        />
        </GuideHighlight.Provider>
      </div>
    </div>
  );
}

// Mounted (hidden) for the whole session; memo keeps App's playback-state
// changes from re-rendering the guide.
export const ChannelPanel = memo(ChannelPanelImpl);
