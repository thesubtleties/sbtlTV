import { useState, useEffect, useCallback, useRef } from 'react';
import type { MpvStatus } from './types/electron';
import { Settings } from './components/Settings';
import { Sidebar, type View } from './components/Sidebar';
import { NowPlayingBar } from './components/NowPlayingBar';
import { CategoryStrip } from './components/CategoryStrip';
import { ChannelPanel } from './components/ChannelPanel';
import { MoviesPage } from './components/MoviesPage';
import { SeriesPage } from './components/SeriesPage';
import { useSelectedCategory } from './hooks/useChannels';
import { syncAllSources, syncAllVod } from './db/sync';
import type { StoredChannel } from './db';

function App() {
  // mpv state
  const [mpvReady, setMpvReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(100);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentChannel, setCurrentChannel] = useState<StoredChannel | null>(null);

  // UI state
  const [showControls, setShowControls] = useState(true);
  const [lastActivity, setLastActivity] = useState(Date.now());
  const [activeView, setActiveView] = useState<View>('none');
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  // Channel/category state (persisted)
  const { categoryId, setCategoryId, loading: categoryLoading } = useSelectedCategory();

  // Sync state
  const [syncing, setSyncing] = useState(false);

  // Track volume slider dragging to ignore mpv updates during drag
  const volumeDraggingRef = useRef(false);

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
    }, 3000);

    return () => clearTimeout(timer);
  }, [lastActivity, playing, activeView, categoriesOpen]);

  // Show controls on mouse move and reset hide timer
  const handleMouseMove = useCallback(() => {
    setShowControls(true);
    setLastActivity(Date.now()); // Always new value = resets timer
  }, []);

  // Control handlers
  const handleLoadStream = async (channel: StoredChannel) => {
    if (!window.mpv) return;
    setError(null);
    const result = await window.mpv.load(channel.direct_url);
    if (result.error) {
      setError(result.error);
    } else {
      setCurrentChannel(channel);
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
    if (!window.mpv) return;
    await window.mpv.stop();
    setPlaying(false);
    setCurrentChannel(null);
  };

  // Play a channel
  const handlePlayChannel = (channel: StoredChannel) => {
    handleLoadStream(channel);
  };

  // Play VOD content (movies/series)
  const handlePlayVod = async (url: string, title: string) => {
    if (!window.mpv) return;
    setError(null);
    const result = await window.mpv.load(url);
    if (result.error) {
      setError(result.error);
    } else {
      // Create a pseudo-channel for the now playing bar
      setCurrentChannel({
        stream_id: 'vod',
        name: title,
        stream_icon: '',
        epg_channel_id: '',
        category_ids: [],
        direct_url: url,
        source_id: 'vod',
      });
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

  // Sync sources on app load (if sources exist)
  useEffect(() => {
    const doInitialSync = async () => {
      if (!window.storage) return;
      const result = await window.storage.getSources();
      if (result.data && result.data.length > 0) {
        setSyncing(true);
        await syncAllSources();
        // Also sync VOD for Xtream sources
        const hasXtream = result.data.some(s => s.type === 'xtream' && s.enabled);
        if (hasXtream) {
          await syncAllVod();
        }
        setSyncing(false);
      }
    };
    doInitialSync();
  }, []);

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
    <div className="app" onMouseMove={handleMouseMove}>
      {/* Custom title bar for frameless window */}
      <div className="title-bar">
        <span className="title-bar-title">sbtlTV</span>
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

      {/* Background - transparent over mpv */}
      <div className="video-background">
        {!currentChannel && (
          <div className="placeholder">
            <h1>sbtlTV</h1>
            <p>{syncing ? 'Loading channels...' : 'Select a channel to begin'}</p>
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
        onTogglePlay={handleTogglePlay}
        onStop={handleStop}
        onToggleMute={handleToggleMute}
        onVolumeChange={handleVolumeChange}
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

      {/* Resize grip for frameless window (Windows only - frameless windows lack native resize) */}
      {window.platform?.isWindows && (
      <div
        className="resize-grip"
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
