import { useState, useEffect, useCallback } from 'react';
import type { Source } from '../types/electron';
import { SourcesTab } from './settings/SourcesTab';
import { TmdbTab } from './settings/TmdbTab';
import { DataRefreshTab } from './settings/DataRefreshTab';
import { MoviesTab } from './settings/MoviesTab';
import { SeriesTab } from './settings/SeriesTab';
import { PosterDbTab } from './settings/PosterDbTab';
import './Settings.css';

interface SettingsProps {
  onClose: () => void;
}

type TabId = 'sources' | 'tmdb' | 'refresh' | 'movies' | 'series' | 'posterdb';

interface Tab {
  id: TabId;
  label: string;
  requiresXtream?: boolean;
}

const TABS: Tab[] = [
  { id: 'sources', label: 'Sources' },
  { id: 'tmdb', label: 'TMDB' },
  { id: 'refresh', label: 'Refresh' },
  { id: 'movies', label: 'Movies', requiresXtream: true },
  { id: 'series', label: 'Series', requiresXtream: true },
  { id: 'posterdb', label: 'Poster DB' },
];

export function Settings({ onClose }: SettingsProps) {
  const [activeTab, setActiveTab] = useState<TabId>('sources');
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

  // Load sources and check encryption on mount
  useEffect(() => {
    loadSources();
    checkEncryption();
    loadSettings();
  }, []);

  async function loadSources() {
    if (!window.storage) return;
    const result = await window.storage.getSources();
    if (result.data) {
      setSources(result.data);
    }
  }

  async function checkEncryption() {
    if (!window.storage) return;
    const result = await window.storage.isEncryptionAvailable();
    if (result.data !== undefined) {
      setIsEncryptionAvailable(result.data);
    }
  }

  async function loadSettings() {
    if (!window.storage) return;
    const result = await window.storage.getSettings();
    if (result.data) {
      const settings = result.data as {
        tmdbApiKey?: string;
        vodRefreshHours?: number;
        epgRefreshHours?: number;
        movieGenresEnabled?: number[];
        seriesGenresEnabled?: number[];
        posterDbApiKey?: string;
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
      setPosterDbApiKey(settings.posterDbApiKey || '');
    }
  }

  // Check if any Xtream source exists
  const hasXtreamSource = sources.some(s => s.type === 'xtream');

  // Filter tabs based on whether Xtream source exists
  const visibleTabs = TABS.filter(tab => !tab.requiresXtream || hasXtreamSource);

  // Ensure active tab is visible
  useEffect(() => {
    if (!visibleTabs.find(t => t.id === activeTab)) {
      setActiveTab('sources');
    }
  }, [visibleTabs, activeTab]);

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
      case 'movies':
        return (
          <MoviesTab
            tmdbApiKey={tmdbApiKey || null}
            enabledGenres={movieGenresEnabled}
            onEnabledGenresChange={handleMovieGenresChange}
          />
        );
      case 'series':
        return (
          <SeriesTab
            tmdbApiKey={tmdbApiKey || null}
            enabledGenres={seriesGenresEnabled}
            onEnabledGenresChange={handleSeriesGenresChange}
          />
        );
      case 'posterdb':
        return (
          <PosterDbTab
            apiKey={posterDbApiKey}
            onApiKeyChange={setPosterDbApiKey}
          />
        );
      default:
        return null;
    }
  }

  return (
    <div className="settings-overlay">
      <div className="settings-panel">
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

        {/* Tab Navigation */}
        <div className="settings-tabs">
          {visibleTabs.map(tab => (
            <button
              key={tab.id}
              className={`settings-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="settings-tab-panel">
          {renderTabContent()}
        </div>
      </div>
    </div>
  );
}
