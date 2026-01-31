import { useState, useEffect, useCallback } from 'react';
import type { Source } from '../types/electron';
import { SettingsSidebar, type SettingsTabId } from './settings/SettingsSidebar';
import { SourcesTab } from './settings/SourcesTab';
import { TmdbTab } from './settings/TmdbTab';
import { DataRefreshTab } from './settings/DataRefreshTab';
import { ChannelsTab } from './settings/ChannelsTab';
import { MoviesTab } from './settings/MoviesTab';
import { SeriesTab } from './settings/SeriesTab';
import { PosterDbTab } from './settings/PosterDbTab';
import { SecurityTab } from './settings/SecurityTab';
import { DebugTab } from './settings/DebugTab';
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

  // Channel display state
  const [channelSortOrder, setChannelSortOrder] = useState<'alphabetical' | 'number'>('alphabetical');

  // Loading state for settings
  const [settingsLoaded, setSettingsLoaded] = useState(false);

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

  async function loadSettings() {
    if (!window.storage) {
      console.error('[Settings] window.storage unavailable - Electron IPC bridge missing');
      return;
    }
    const result = await window.storage.getSettings();
    if (result.data) {
      const settings = result.data as {
        tmdbApiKey?: string;
        vodRefreshHours?: number;
        epgRefreshHours?: number;
        movieGenresEnabled?: number[];
        seriesGenresEnabled?: number[];
        posterDbApiKey?: string;
        rpdbBackdropsEnabled?: boolean;
        allowLanSources?: boolean;
        debugLoggingEnabled?: boolean;
        channelSortOrder?: 'alphabetical' | 'number';
      };

      // Load TMDB API key
      const key = settings.tmdbApiKey || '';
      setTmdbApiKey(key);
      if (key) {
        setTmdbKeyValid(true); // Assume valid if previously saved
      }

      // Load refresh settings
      if (settings.vodRefreshHours !== undefined) {
        setVodRefreshHours(settings.vodRefreshHours);
      }
      if (settings.epgRefreshHours !== undefined) {
        setEpgRefreshHours(settings.epgRefreshHours);
      }

      // Load genre settings
      setMovieGenresEnabled(settings.movieGenresEnabled);
      setSeriesGenresEnabled(settings.seriesGenresEnabled);

      // Load PosterDB key
      const rpdbKey = settings.posterDbApiKey || '';
      setPosterDbApiKey(rpdbKey);
      if (rpdbKey) {
        setPosterDbKeyValid(true); // Assume valid if previously saved
      }
      setRpdbBackdropsEnabled(settings.rpdbBackdropsEnabled ?? false);

      // Load security settings
      setAllowLanSources(settings.allowLanSources ?? false);

      // Load debug settings
      setDebugLoggingEnabled(settings.debugLoggingEnabled ?? false);

      // Load channel display settings
      setChannelSortOrder(settings.channelSortOrder ?? 'alphabetical');
    }
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
          <ChannelsTab
            channelSortOrder={channelSortOrder}
            onChannelSortOrderChange={setChannelSortOrder}
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
