import { useState, useEffect, useCallback } from 'react';
import type { Source } from '../types/electron';
import { useUIStore, useSettingsLoaded } from '../stores/uiStore';
import { SettingsSidebar, type SettingsTabId } from './settings/SettingsSidebar';
import { SourcesTab } from './settings/SourcesTab';
import { TmdbTab } from './settings/TmdbTab';
import { DataRefreshTab } from './settings/DataRefreshTab';
import { EpgTab } from './settings/ChannelsTab';
import { MoviesTab } from './settings/MoviesTab';
import { SeriesTab } from './settings/SeriesTab';
import { PosterDbTab } from './settings/PosterDbTab';
import { SecurityTab } from './settings/SecurityTab';
import { DebugTab } from './settings/DebugTab';
import { AboutTab } from './settings/AboutTab';
import './Settings.css';

interface SettingsProps {
  onClose: () => void;
}

export function Settings({ onClose }: SettingsProps) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>('sources');
  const [sources, setSources] = useState<Source[]>([]);
  const [isEncryptionAvailable, setIsEncryptionAvailable] = useState(true);

  // TMDB API key state
  const [tmdbApiKey, setTmdbApiKey] = useState('');
  const [tmdbKeyValid, setTmdbKeyValid] = useState<boolean | null>(null);

  // Refresh settings state
  const [vodRefreshHours, setVodRefreshHours] = useState(24);
  const [epgRefreshHours, setEpgRefreshHours] = useState(6);

  // Genre settings state
  const [movieGenresEnabled, setMovieGenresEnabled] = useState<number[] | undefined>(undefined);
  const [seriesGenresEnabled, setSeriesGenresEnabled] = useState<number[] | undefined>(undefined);

  // PosterDB state
  const [posterDbApiKey, setPosterDbApiKey] = useState('');
  const [posterDbKeyValid, setPosterDbKeyValid] = useState<boolean | null>(null);
  const [rpdbBackdropsEnabled, setRpdbBackdropsEnabled] = useState(false);

  // Security state
  const [allowLanSources, setAllowLanSources] = useState(false);

  // Debug state
  const [debugLoggingEnabled, setDebugLoggingEnabled] = useState(false);

  // Auto-update state (default ON)
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(true);

  // Channel display state
  const [channelSortOrder, setChannelSortOrder] = useState<'alphabetical' | 'number'>('alphabetical');

  // Guide appearance state
  const [categoryBarWidth, setCategoryBarWidth] = useState(160);
  const [guideOpacity, setGuideOpacity] = useState(0.95);

  // Loading state for settings
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const storeSettingsLoaded = useSettingsLoaded();

  // Load sources and check encryption on mount
  useEffect(() => {
    loadSources();
    checkEncryption();
    loadSettings();
  }, []);

  async function loadSources() {
    // window.storage is the Electron IPC bridge - if missing, app is broken
    if (!window.storage) {
      console.error('[Settings] window.storage unavailable - Electron IPC bridge missing');
      return;
    }
    const result = await window.storage.getSources();
    if (result.data) {
      setSources(result.data);
    }
  }

  async function checkEncryption() {
    if (!window.storage) {
      console.error('[Settings] window.storage unavailable - Electron IPC bridge missing');
      return;
    }
    const result = await window.storage.isEncryptionAvailable();
    if (result.data !== undefined) {
      setIsEncryptionAvailable(result.data);
    }
  }

  function loadSettings() {
    // Read from Zustand (hydrated at startup in App.tsx) — no IPC call
    const s = useUIStore.getState().settings;

    // Load TMDB API key
    const key = s.tmdbApiKey || '';
    setTmdbApiKey(key);
    if (key) {
      setTmdbKeyValid(true); // Assume valid if previously saved
    }

    // Load refresh settings
    setVodRefreshHours(s.vodRefreshHours ?? 24);
    setEpgRefreshHours(s.epgRefreshHours ?? 6);

    // Load genre settings
    setMovieGenresEnabled(s.movieGenresEnabled);
    setSeriesGenresEnabled(s.seriesGenresEnabled);

    // Load PosterDB key
    const rpdbKey = s.posterDbApiKey || '';
    setPosterDbApiKey(rpdbKey);
    if (rpdbKey) {
      setPosterDbKeyValid(true); // Assume valid if previously saved
    }
    setRpdbBackdropsEnabled(s.rpdbBackdropsEnabled ?? false);

    // Load security settings
    setAllowLanSources(s.allowLanSources ?? false);

    // Load debug settings
    setDebugLoggingEnabled(s.debugLoggingEnabled ?? false);

    // Load channel display settings
    setChannelSortOrder(s.channelSortOrder ?? 'alphabetical');

    // Load auto-update setting (default ON)
    setAutoUpdateEnabled(s.autoUpdateEnabled ?? true);

    // Load guide appearance settings
    setCategoryBarWidth(s.categoryBarWidth ?? 160);
    setGuideOpacity(s.guideOpacity ?? 0.95);

    setSettingsLoaded(true);
  }

  // Check if any Xtream source exists (for showing Movies/Series tabs)
  const hasXtreamSource = sources.some(s => s.type === 'xtream');

  // Reset to sources tab if current tab becomes hidden
  useEffect(() => {
    const libraryTabs: SettingsTabId[] = ['movies', 'series'];
    if (libraryTabs.includes(activeTab) && !hasXtreamSource) {
      setActiveTab('sources');
    }
  }, [hasXtreamSource, activeTab]);

  // Memoized callbacks for genre changes
  const handleMovieGenresChange = useCallback((genres: number[]) => {
    setMovieGenresEnabled(genres);
  }, []);

  const handleSeriesGenresChange = useCallback((genres: number[]) => {
    setSeriesGenresEnabled(genres);
  }, []);

  function renderTabContent() {
    switch (activeTab) {
      case 'sources':
        return (
          <SourcesTab
            sources={sources}
            isEncryptionAvailable={isEncryptionAvailable}
            onSourcesChange={loadSources}
          />
        );
      case 'tmdb':
        return (
          <TmdbTab
            tmdbApiKey={tmdbApiKey}
            tmdbKeyValid={tmdbKeyValid}
            onApiKeyChange={setTmdbApiKey}
            onApiKeyValidChange={setTmdbKeyValid}
          />
        );
      case 'refresh':
        return (
          <DataRefreshTab
            vodRefreshHours={vodRefreshHours}
            epgRefreshHours={epgRefreshHours}
            onVodRefreshChange={setVodRefreshHours}
            onEpgRefreshChange={setEpgRefreshHours}
          />
        );
      case 'channels':
        return (
          <EpgTab
            channelSortOrder={channelSortOrder}
            onChannelSortOrderChange={setChannelSortOrder}
            categoryBarWidth={categoryBarWidth}
            guideOpacity={guideOpacity}
            onCategoryBarWidthChange={setCategoryBarWidth}
            onGuideOpacityChange={setGuideOpacity}
          />
        );
      case 'movies':
        return (
          <MoviesTab
            tmdbApiKey={tmdbApiKey || null}
            enabledGenres={movieGenresEnabled}
            onEnabledGenresChange={handleMovieGenresChange}
            settingsLoaded={settingsLoaded}
          />
        );
      case 'series':
        return (
          <SeriesTab
            tmdbApiKey={tmdbApiKey || null}
            enabledGenres={seriesGenresEnabled}
            onEnabledGenresChange={handleSeriesGenresChange}
            settingsLoaded={settingsLoaded}
          />
        );
      case 'posterdb':
        return (
          <PosterDbTab
            apiKey={posterDbApiKey}
            apiKeyValid={posterDbKeyValid}
            onApiKeyChange={setPosterDbApiKey}
            onApiKeyValidChange={setPosterDbKeyValid}
            backdropsEnabled={rpdbBackdropsEnabled}
            onBackdropsEnabledChange={setRpdbBackdropsEnabled}
          />
        );
      case 'security':
        return (
          <SecurityTab
            allowLanSources={allowLanSources}
            onAllowLanSourcesChange={setAllowLanSources}
          />
        );
      case 'debug':
        return (
          <DebugTab
            debugLoggingEnabled={debugLoggingEnabled}
            onDebugLoggingChange={setDebugLoggingEnabled}
          />
        );
      case 'about':
        return (
          <AboutTab
            autoUpdateEnabled={autoUpdateEnabled}
            onAutoUpdateChange={setAutoUpdateEnabled}
          />
        );
      default:
        return null;
    }
  }

  return (
    <div className="settings-overlay">
      <div className="settings-panel settings-panel--sidebar">
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        {/* Encryption Warning */}
        {!isEncryptionAvailable && (
          <div className="encryption-warning">
            <span className="warning-icon">Warning:</span>
            <span>
              Secure storage unavailable. Credentials will be stored without encryption.
              <br />
              <small>Install a keyring (gnome-keyring, kwallet) for secure storage.</small>
            </span>
          </div>
        )}

        <div className="settings-body">
          {/* Sidebar Navigation */}
          <SettingsSidebar
            activeTab={activeTab}
            onTabChange={setActiveTab}
            hasXtreamSource={hasXtreamSource}
          />

          {/* Tab Content */}
          <div className="settings-content">
            {renderTabContent()}
          </div>
        </div>
      </div>
    </div>
  );
}
