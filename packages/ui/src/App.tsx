import { useState, useEffect, useCallback, useRef } from 'react';
import type { MpvStatus } from './types/electron';
import { Settings } from './components/Settings';
import { Sidebar, type View } from './components/Sidebar';
import { NowPlayingBar } from './components/NowPlayingBar';
import { CategoryStrip } from './components/CategoryStrip';
import { ChannelPanel } from './components/ChannelPanel';
import { MoviesPage } from './components/MoviesPage';
import { SeriesPage } from './components/SeriesPage';
import { Logo } from './components/Logo';
import { UpdateNotification } from './components/UpdateNotification';
import { VideoCanvas } from './components/VideoCanvas';
import { useSelectedCategory } from './hooks/useChannels';
import { useCssVariableSync } from './hooks/useCssVariableSync';
import { useUIStore, useChannelSyncing, useVodSyncing, useTmdbMatching, useSetChannelSyncing, useSetVodSyncing } from './stores/uiStore';
import { syncVodForSource, isVodStale, isEpgStale, syncSource } from './db/sync';
import type { StoredChannel } from './db';
import type { VodPlayInfo } from './types/media';

// Auto-hide controls after this many milliseconds of inactivity
const CONTROLS_AUTO_HIDE_MS = 3000;

// Debug logging helper for UI playback
function debugLog(message: string, category = 'play'): void {
  const logMsg = `[${category}] ${message}`;
  console.log(logMsg);
  if (window.debug?.logFromRenderer) {
    window.debug.logFromRenderer(logMsg).catch(() => {});
  }
}

/**
 * Generate fallback stream URLs when primary fails.
 * Live TV: .ts → .m3u8 → .m3u
 * VOD: provider extension → .m3u8 → .ts
 */
function getStreamFallbacks(url: string, isLive: boolean): string[] {
  try {
    // Parse URL properly to preserve query params (often used for auth tokens)
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;

    const extMatch = pathname.match(/\.([a-z0-9]+)$/i);
    if (!extMatch) return []; // No extension, can't generate fallbacks

    const currentExt = extMatch[1].toLowerCase();
    const basePathname = pathname.slice(0, -currentExt.length - 1);

    const generateUrl = (ext: string): string => {
      const newUrl = new URL(url);
      newUrl.pathname = `${basePathname}.${ext}`;
      return newUrl.toString();
    };

    if (isLive) {
      // Live TV fallback order: .ts → .m3u8 → .m3u
      const fallbacks: string[] = [];
      if (currentExt !== 'm3u8') fallbacks.push(generateUrl('m3u8'));
      if (currentExt !== 'm3u') fallbacks.push(generateUrl('m3u'));
      return fallbacks;
    } else {
      // VOD fallback order: provider ext → .m3u8 → .ts
      const fallbacks: string[] = [];
      if (currentExt !== 'm3u8') fallbacks.push(generateUrl('m3u8'));
      if (currentExt !== 'ts') fallbacks.push(generateUrl('ts'));
      return fallbacks;
    }
  } catch {
    // Invalid URL, can't generate fallbacks
    return [];
  }
}

/**
 * Try loading a stream URL with fallbacks on failure.
 * Returns the successful URL or null if all failed.
 */
async function tryLoadWithFallbacks(
  primaryUrl: string,
  isLive: boolean,
  mpv: NonNullable<typeof window.mpv>
): Promise<{ success: boolean; url: string; error?: string }> {
  debugLog(`Attempting to load: ${primaryUrl} (isLive: ${isLive})`);

  // Try primary URL first
  const result = await mpv.load(primaryUrl);
  if (!result.error) {
    debugLog(`Primary URL loaded successfully`);
    return { success: true, url: primaryUrl };
  }
  debugLog(`Primary URL failed: ${result.error}`);

  // Try fallbacks
  const fallbacks = getStreamFallbacks(primaryUrl, isLive);
  debugLog(`Trying ${fallbacks.length} fallback URLs...`);
  for (const fallbackUrl of fallbacks) {
    debugLog(`Trying fallback: ${fallbackUrl}`);
    const fallbackResult = await mpv.load(fallbackUrl);
    if (!fallbackResult.error) {
      debugLog(`Fallback succeeded: ${fallbackUrl}`);
      return { success: true, url: fallbackUrl };
    }
    debugLog(`Fallback failed: ${fallbackResult.error}`);
  }

  // All failed - return original error
  debugLog(`All URLs failed, returning error: ${result.error}`);
  return { success: false, url: primaryUrl, error: result.error };
}

function App() {
  useCssVariableSync();

  // mpv state
  const [mpvReady, setMpvReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(100);
  const [muted, setMuted] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [currentChannel, setCurrentChannel] = useState<StoredChannel | null>(null);
  const [vodInfo, setVodInfo] = useState<VodPlayInfo | null>(null);

  // UI state
  const [showControls, setShowControls] = useState(true);
  const [lastActivity, setLastActivity] = useState(Date.now());
  const [activeView, setActiveView] = useState<View>('none');
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  // Channel/category state (persisted)
  const { categoryId, setCategoryId, loading: categoryLoading } = useSelectedCategory();

  // Global sync state (from Settings)
  const channelSyncing = useChannelSyncing();
  const vodSyncing = useVodSyncing();
  const tmdbMatching = useTmdbMatching();
  const setChannelSyncing = useSetChannelSyncing();
  const setVodSyncing = useSetVodSyncing();
  // Track volume slider dragging to ignore mpv updates during drag
  const volumeDraggingRef = useRef(false);

  // Track seeking to prevent position flickering during scrub
  const seekingRef = useRef(false);

  // Track if mouse is hovering over controls (prevents auto-hide)
  const controlsHoveredRef = useRef(false);

  // Set up mpv event listeners
  useEffect(() => {
    if (!window.mpv) {
      setError('mpv API not available - are you running in Electron?');
      return;
    }

    window.mpv.onReady((ready) => {
      console.log('mpv ready:', ready);
      setMpvReady(ready);
    });

    window.mpv.onStatus((status: MpvStatus) => {
      if (status.playing !== undefined) setPlaying(status.playing);
      // Skip volume updates while user is dragging the slider
      if (status.volume !== undefined && !volumeDraggingRef.current) {
        setVolume(status.volume);
      }
      if (status.muted !== undefined) setMuted(status.muted);
      // Skip position updates while user is seeking (prevents flickering)
      if (status.position !== undefined && !seekingRef.current) {
        setPosition(status.position);
      }
      if (status.duration !== undefined) {
        setDuration(status.duration);
      }
    });

    window.mpv.onError((err) => {
      console.error('mpv error:', err);
      setError(err);
    });

    return () => {
      window.mpv?.removeAllListeners();
    };
  }, []);

  // Auto-hide controls after 3 seconds of no activity
  useEffect(() => {
    // Don't auto-hide if not playing or if panels are open
    if (!playing || activeView !== 'none' || categoriesOpen) return;

    const timer = setTimeout(() => {
      // Don't hide if mouse is hovering over controls
      if (!controlsHoveredRef.current) {
        setShowControls(false);
      }
    }, CONTROLS_AUTO_HIDE_MS);

    return () => clearTimeout(timer);
  }, [lastActivity, playing, activeView, categoriesOpen]);

  // Show controls on mouse move and reset hide timer
  const handleMouseMove = useCallback(() => {
    setShowControls(true);
    setLastActivity(Date.now()); // Always new value = resets timer
  }, []);

  // Control handlers
  const handleLoadStream = async (channel: StoredChannel) => {
    debugLog(`handleLoadStream: ${channel.name} (${channel.stream_id})`);
    debugLog(`  URL: ${channel.direct_url}`);
    if (!window.mpv) {
      debugLog('  ABORT: window.mpv not available');
      return;
    }
    setError(null);
    const result = await tryLoadWithFallbacks(channel.direct_url, true, window.mpv);
    if (!result.success) {
      debugLog(`  FAILED: ${result.error}`);
      setError(result.error ?? 'Failed to load stream');
    } else {
      debugLog(`  SUCCESS: playing`);
      // Update channel with working URL if fallback was used
      setCurrentChannel(result.url !== channel.direct_url
        ? { ...channel, direct_url: result.url }
        : channel
      );
      setPlaying(true);
    }
  };

  const handleTogglePlay = async () => {
    if (!window.mpv) return;
    await window.mpv.togglePause();
  };

  const handleVolumeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseInt(e.target.value);
    setVolume(newVolume);
    if (window.mpv) {
      await window.mpv.setVolume(newVolume);
    }
  };

  const handleToggleMute = async () => {
    if (!window.mpv) return;
    await window.mpv.toggleMute();
    // UI state updated via mpv status callback
  };

  const handleStop = async () => {
    debugLog('handleStop called');
    if (!window.mpv) return;
    await window.mpv.stop();
    debugLog('handleStop: mpv.stop() completed');
    setPlaying(false);
    setCurrentChannel(null);
  };

  const handleSeek = async (seconds: number) => {
    if (!window.mpv) return;
    seekingRef.current = true;
    setPosition(seconds); // Optimistic update
    await window.mpv.seek(seconds);
    // Brief delay before accepting mpv updates again
    setTimeout(() => { seekingRef.current = false; }, 200);
  };

  // Play a channel
  const handlePlayChannel = (channel: StoredChannel) => {
    handleLoadStream(channel);
  };

  // Play VOD content (movies/series)
  const handlePlayVod = async (info: VodPlayInfo) => {
    debugLog(`handlePlayVod: ${info.title} (${info.type})`);
    debugLog(`  URL: ${info.url}`);
    if (!window.mpv) {
      debugLog('  ABORT: window.mpv not available');
      return;
    }
    setError(null);
    const result = await tryLoadWithFallbacks(info.url, false, window.mpv);
    if (!result.success) {
      debugLog(`  FAILED: ${result.error}`);
      setError(result.error ?? 'Failed to load stream');
    } else {
      debugLog(`  SUCCESS: playing`);
      // Create a pseudo-channel for the now playing bar
      const workingUrl = result.url;
      setCurrentChannel({
        stream_id: 'vod',
        name: info.title,
        stream_icon: '',
        epg_channel_id: '',
        category_ids: [],
        direct_url: workingUrl,
        source_id: 'vod',
      });
      setVodInfo({ ...info, url: workingUrl });
      setPlaying(true);
      // Close VOD pages when playing
      setActiveView('none');
    }
  };

  // Handle category selection - opens guide if closed
  const handleSelectCategory = (catId: string | null) => {
    setCategoryId(catId);
    // Open guide if it's not already open
    if (activeView !== 'guide') {
      setActiveView('guide');
    }
  };

  // Hydrate settings from disk into Zustand (runs unconditionally, even without sources)
  useEffect(() => {
    async function loadSettings() {
      if (!window.storage) return;
      try {
        const result = await window.storage.getSettings();
        if (result.data) {
          useUIStore.getState().hydrateSettings(result.data);
        } else {
          // No settings on disk yet — still mark as loaded with defaults
          useUIStore.getState().hydrateSettings({} as any);
        }
      } catch (err) {
        console.error('[App] Failed to load settings:', err);
        useUIStore.getState().hydrateSettings({} as any);
      }
    }
    loadSettings();
  }, []);

  // Register auto-updater event listeners once (centralized in Zustand)
  useEffect(() => {
    if (!window.updater) return;
    const store = useUIStore.getState;
    window.updater.onUpdateAvailable((info) => {
      debugLog(`Update available: ${info.version}`, 'updater');
      store().setUpdaterState({ phase: 'downloading', percent: 0, version: info.version });
    });
    window.updater.onDownloadProgress((progress) => {
      store().setUpdaterDownloadProgress(progress.percent);
    });
    window.updater.onUpdateDownloaded((info) => {
      debugLog(`Update downloaded: ${info.version}`, 'updater');
      store().setUpdaterState({ phase: 'ready', version: info.version });
    });
    window.updater.onError((err) => {
      debugLog(`Updater error: ${err.message}`, 'updater');
      store().setUpdaterState({ phase: 'error', message: err.message });
    });
    return () => window.updater?.removeAllListeners();
  }, []);

  // Sync sources on app load (if sources exist)
  useEffect(() => {
    const doInitialSync = async () => {
      if (!window.storage) return;
      try {
        const result = await window.storage.getSources();
        if (result.data && result.data.length > 0) {
          // Read refresh settings from Zustand (already hydrated)
          const { settings } = useUIStore.getState();
          const epgRefreshHrs = settings.epgRefreshHours ?? 6;
          const vodRefreshHrs = settings.vodRefreshHours ?? 24;

          // Sync channels/EPG only for stale sources
          const enabledSources = result.data.filter(s => s.enabled);
          const staleSources = [];
          for (const source of enabledSources) {
            const stale = await isEpgStale(source.id, epgRefreshHrs);
            if (stale) {
              staleSources.push(source);
            } else {
              debugLog(`Source ${source.name} is fresh, skipping channel/EPG sync`, 'sync');
            }
          }

          if (staleSources.length > 0) {
            setChannelSyncing(true);
            for (const source of staleSources) {
              debugLog(`Source ${source.name} is stale, syncing...`, 'sync');
              await syncSource(source);
            }
          }

          // Sync VOD only for Xtream sources that are stale
          const xtreamSources = result.data.filter(s => s.type === 'xtream' && s.enabled);
          if (xtreamSources.length > 0) {
            const staleVodSources = [];
            for (const source of xtreamSources) {
              const stale = await isVodStale(source.id, vodRefreshHrs);
              if (stale) {
                staleVodSources.push(source);
              } else {
                debugLog(`Source ${source.name} is fresh, skipping VOD sync`, 'vod');
              }
            }

            if (staleVodSources.length > 0) {
              setVodSyncing(true);
              for (const source of staleVodSources) {
                debugLog(`Source ${source.name} is stale, syncing VOD...`, 'vod');
                await syncVodForSource(source);
              }
            }
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        debugLog(`Initial sync failed: ${errMsg}`, 'sync');
        console.error('[App] Initial sync failed:', err);
      } finally {
        setChannelSyncing(false);
        setVodSyncing(false);
      }
    };
    doInitialSync();
  }, [setChannelSyncing, setVodSyncing]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          handleTogglePlay();
          break;
        case 'm':
          handleToggleMute();
          break;
        case 'g':
          // Toggle guide
          setActiveView((v) => (v === 'guide' ? 'none' : 'guide'));
          break;
        case 'c':
          // Toggle categories
          setCategoriesOpen((open) => !open);
          break;
        case 'Escape':
          setActiveView('none');
          setCategoriesOpen(false);
          setShowControls(false);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Window control handlers
  const handleMinimize = () => window.electronWindow?.minimize();
  const handleMaximize = () => window.electronWindow?.maximize();
  const handleClose = () => window.electronWindow?.close();

  return (
    <div className={`app${showControls ? '' : ' controls-hidden'}`} onMouseMove={handleMouseMove}>
      {/* Custom title bar for frameless window */}
      <div className={`title-bar${showControls ? ' visible' : ''}`}>
        <Logo className="title-bar-logo" />
        <div className="window-controls">
          <button onClick={handleMinimize} title="Minimize">
            ─
          </button>
          <button onClick={handleMaximize} title="Maximize">
            □
          </button>
          <button onClick={handleClose} className="close" title="Close">
            ✕
          </button>
        </div>
      </div>

      {/* Video canvas for native mpv mode - displays VideoFrames from sharedTexture */}
      <VideoCanvas visible={!!currentChannel && playing} />

      {/* Background - transparent over mpv (external mode) or behind VideoCanvas (native mode) */}
      <div className="video-background">
        {!currentChannel && (
          <div className="placeholder">
            <Logo className="placeholder__logo" />
            {(channelSyncing || vodSyncing || tmdbMatching) ? (
              <div className="sync-status">
                <div className="sync-status__spinner" />
                <span className="sync-status__text">
                  {channelSyncing && vodSyncing
                    ? 'Syncing channels & VOD...'
                    : channelSyncing
                    ? 'Syncing channels...'
                    : vodSyncing
                    ? 'Syncing VOD...'
                    : 'Matching with TMDB...'}
                </span>
              </div>
            ) : (
              <div className="placeholder__spacer" />
            )}
          </div>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="error-banner">
          <span>Error: {error}</span>
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {/* Now Playing Bar */}
      <NowPlayingBar
        visible={showControls}
        channel={currentChannel}
        playing={playing}
        muted={muted}
        volume={volume}
        mpvReady={mpvReady}
        position={position}
        duration={duration}
        isVod={currentChannel?.stream_id === 'vod'}
        vodInfo={vodInfo}
        onTogglePlay={handleTogglePlay}
        onStop={handleStop}
        onToggleMute={handleToggleMute}
        onVolumeChange={handleVolumeChange}
        onSeek={handleSeek}
        onVolumeDragStart={() => { volumeDraggingRef.current = true; }}
        onVolumeDragEnd={() => { volumeDraggingRef.current = false; }}
        onMouseEnter={() => { controlsHoveredRef.current = true; }}
        onMouseLeave={() => { controlsHoveredRef.current = false; }}
      />

      {/* Sidebar Navigation - stays visible when any panel is open */}
      <Sidebar
        activeView={activeView}
        onViewChange={setActiveView}
        visible={showControls || categoriesOpen || activeView !== 'none'}
        categoriesOpen={categoriesOpen}
        onCategoriesToggle={() => setCategoriesOpen((open) => !open)}
        onCategoriesClose={() => setCategoriesOpen(false)}
        expanded={sidebarExpanded}
        onExpandedToggle={() => setSidebarExpanded((exp) => !exp)}
      />

      {/* Category Strip - slides out from sidebar */}
      <CategoryStrip
        selectedCategoryId={categoryId}
        onSelectCategory={handleSelectCategory}
        visible={categoriesOpen}
        sidebarExpanded={sidebarExpanded}
      />

      {/* Channel Panel - slides out (shifts right if categories open) */}
      <ChannelPanel
        categoryId={categoryId}
        visible={activeView === 'guide'}
        categoryStripOpen={categoriesOpen}
        sidebarExpanded={sidebarExpanded}
        onPlayChannel={handlePlayChannel}
        onClose={() => setActiveView('none')}
      />

      {/* Settings Panel */}
      {activeView === 'settings' && <Settings onClose={() => setActiveView('none')} />}

      {/* Movies Page */}
      {activeView === 'movies' && (
        <MoviesPage
          onPlay={handlePlayVod}
          onClose={() => setActiveView('none')}
        />
      )}

      {/* Series Page */}
      {activeView === 'series' && (
        <SeriesPage
          onPlay={handlePlayVod}
          onClose={() => setActiveView('none')}
        />
      )}

      {/* Update notification toast */}
      <UpdateNotification />

      {/* Resize grip for frameless window — Electron frameless windows lack native resize edges */}
      {(window.platform?.isWindows || window.platform?.isLinux) && (
      <div
        className={`resize-grip${showControls ? ' visible' : ''}`}
        onMouseDown={(e) => {
          e.preventDefault();
          if (!window.electronWindow) return;

          const startX = e.screenX;
          const startY = e.screenY;
          let startWidth = window.innerWidth;
          let startHeight = window.innerHeight;
          let rafId: number | null = null;
          let pendingWidth = startWidth;
          let pendingHeight = startHeight;

          window.electronWindow.getSize().then(([w, h]) => {
            startWidth = w;
            startHeight = h;
          });

          const onMouseMove = (moveEvent: MouseEvent) => {
            pendingWidth = startWidth + (moveEvent.screenX - startX);
            pendingHeight = startHeight + (moveEvent.screenY - startY);

            // Throttle with RAF for smoother resize
            if (rafId === null) {
              rafId = requestAnimationFrame(() => {
                window.electronWindow?.setSize(pendingWidth, pendingHeight);
                rafId = null;
              });
            }
          };

          const onMouseUp = () => {
            if (rafId !== null) cancelAnimationFrame(rafId);
            // Final update to ensure we hit the exact position
            window.electronWindow?.setSize(pendingWidth, pendingHeight);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
          };

          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('mouseup', onMouseUp);
        }}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <path d="M11 21L21 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M15 21L21 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M19 21L21 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
      )}
    </div>
  );
}

export default App;
