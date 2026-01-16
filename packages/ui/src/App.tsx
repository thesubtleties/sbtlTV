import { useState, useEffect, useCallback } from 'react';
import type { MpvStatus } from './types/electron';
import { Settings } from './components/Settings';
import { Sidebar, type View } from './components/Sidebar';
import { CategoryStrip } from './components/CategoryStrip';
import { ChannelPanel } from './components/ChannelPanel';
import { useSelectedCategory } from './hooks/useChannels';
import { syncAllSources } from './db/sync';
import type { StoredChannel } from './db';

function App() {
  // mpv state
  const [mpvReady, setMpvReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(100);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentStream, setCurrentStream] = useState<string | null>(null);

  // UI state
  const [showControls, setShowControls] = useState(true);
  const [activeView, setActiveView] = useState<View>('none');
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  // Channel/category state (persisted)
  const { categoryId, setCategoryId, loading: categoryLoading } = useSelectedCategory();

  // Sync state
  const [syncing, setSyncing] = useState(false);

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
      if (status.volume !== undefined) setVolume(status.volume);
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
    if (!showControls) return;

    const timer = setTimeout(() => {
      if (playing) {
        setShowControls(false);
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, [showControls, playing]);

  // Show controls on mouse move
  const handleMouseMove = useCallback(() => {
    setShowControls(true);
  }, []);

  // Control handlers
  const handleLoadStream = async (url: string, name?: string) => {
    if (!window.mpv) return;
    setError(null);
    const result = await window.mpv.load(url);
    if (result.error) {
      setError(result.error);
    } else {
      setCurrentStream(name || url);
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
    await window.mpv.mute(!muted);
    setMuted(!muted);
  };

  const handleStop = async () => {
    if (!window.mpv) return;
    await window.mpv.stop();
    setPlaying(false);
    setCurrentStream(null);
  };

  // Play a channel
  const handlePlayChannel = (channel: StoredChannel) => {
    handleLoadStream(channel.direct_url, channel.name);
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
        <span className="title-bar-title">neTV</span>
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
        {!currentStream && (
          <div className="placeholder">
            <h1>neTV</h1>
            <p>{syncing ? 'Loading channels...' : 'Select a stream to begin'}</p>
          </div>
        )}
        {currentStream && (
          <div className="now-playing">
            <p>Now playing: {currentStream}</p>
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

      {/* Control Bar */}
      <div className={`control-bar ${showControls ? 'visible' : 'hidden'}`}>
        {/* Status indicator */}
        <div className="status">
          <span className={`indicator ${mpvReady ? 'ready' : 'waiting'}`}>
            {mpvReady ? 'mpv ready' : 'Waiting for mpv...'}
          </span>
        </div>

        {/* Playback controls */}
        <div className="playback-controls">
          <button onClick={handleTogglePlay} disabled={!mpvReady || !currentStream}>
            {playing ? '⏸ Pause' : '▶ Play'}
          </button>
          <button onClick={handleStop} disabled={!mpvReady || !currentStream}>
            ⏹ Stop
          </button>

          <div className="volume-control">
            <button onClick={handleToggleMute} disabled={!mpvReady}>
              {muted ? '🔇' : volume > 50 ? '🔊' : '🔉'}
            </button>
            <input
              type="range"
              min="0"
              max="100"
              value={volume}
              onChange={handleVolumeChange}
              disabled={!mpvReady}
            />
            <span>{volume}%</span>
          </div>
        </div>

        {/* Keyboard hints */}
        <div className="keyboard-hints">
          <span>Space: Play/Pause</span>
          <span>M: Mute</span>
          <span>G: Guide</span>
          <span>C: Categories</span>
        </div>
      </div>

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
    </div>
  );
}

export default App;
