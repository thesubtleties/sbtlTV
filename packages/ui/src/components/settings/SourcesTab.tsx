import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { Source } from '../../types/electron';
import { syncAllSources, syncAllVod, type SyncResult, type VodSyncResult } from '../../db/sync';
import { clearSourceData, clearVodData } from '../../db';
import { useSyncStatus } from '../../hooks/useChannels';

interface SourcesTabProps {
  sources: Source[];
  isEncryptionAvailable: boolean;
  onSourcesChange: () => void;
}

type SourceType = 'm3u' | 'xtream';

interface SourceFormData {
  name: string;
  type: SourceType;
  url: string;
  username: string;
  password: string;
  autoLoadEpg: boolean;
  epgUrl: string;
}

const emptyForm: SourceFormData = {
  name: '',
  type: 'm3u',
  url: '',
  username: '',
  password: '',
  autoLoadEpg: true,
  epgUrl: '',
};

export function SourcesTab({ sources, isEncryptionAvailable, onSourcesChange }: SourcesTabProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<SourceFormData>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResults, setSyncResults] = useState<Map<string, SyncResult> | null>(null);
  const [vodSyncing, setVodSyncing] = useState(false);
  const [vodSyncResults, setVodSyncResults] = useState<Map<string, VodSyncResult> | null>(null);
  const syncStatus = useSyncStatus();

  const hasXtreamSource = sources.some(s => s.type === 'xtream');

  function handleAdd() {
    setFormData(emptyForm);
    setEditingId(null);
    setShowAddForm(true);
    setError(null);
  }

  function handleEdit(source: Source) {
    setFormData({
      name: source.name,
      type: source.type === 'xtream' ? 'xtream' : 'm3u',
      url: source.url,
      username: source.username || '',
      password: source.password || '',
      autoLoadEpg: source.auto_load_epg ?? (source.type === 'xtream'),
      epgUrl: source.epg_url || '',
    });
    setEditingId(source.id);
    setShowAddForm(true);
    setError(null);
  }

  async function handleDelete(id: string, sourceName: string) {
    if (!window.storage) return;

    const confirmed = window.confirm(
      `Delete "${sourceName}"?\n\nThis will remove all channels, EPG, and VOD data from this source.`
    );
    if (!confirmed) return;

    // Clean up all data in IndexedDB before removing source config
    await clearSourceData(id);
    await clearVodData(id);
    await window.storage.deleteSource(id);
    onSourcesChange();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!window.storage) return;

    // Validation
    if (!formData.name.trim()) {
      setError('Name is required');
      return;
    }
    if (!formData.url.trim()) {
      setError('URL is required');
      return;
    }
    if (formData.type === 'xtream' && (!formData.username.trim() || !formData.password.trim())) {
      setError('Username and password are required for Xtream');
      return;
    }

    const source: Source = {
      id: editingId || crypto.randomUUID(),
      name: formData.name.trim(),
      type: formData.type,
      url: formData.url.trim(),
      enabled: true,
      username: formData.type === 'xtream' ? formData.username.trim() : undefined,
      password: formData.type === 'xtream' ? formData.password.trim() : undefined,
      auto_load_epg: formData.autoLoadEpg,
      epg_url: formData.epgUrl.trim() || undefined,
    };

    const result = await window.storage.saveSource(source);
    if (result.error) {
      setError(result.error);
      return;
    }

    setShowAddForm(false);
    setFormData(emptyForm);
    setEditingId(null);
    onSourcesChange();
  }

  function handleCancel() {
    setShowAddForm(false);
    setFormData(emptyForm);
    setEditingId(null);
    setError(null);
  }

  async function handleSync() {
    setSyncing(true);
    setSyncResults(null);
    try {
      const results = await syncAllSources();
      setSyncResults(results);
    } catch (err) {
      console.error('Sync error:', err);
    } finally {
      setSyncing(false);
    }
  }

  async function handleVodSync() {
    setVodSyncing(true);
    setVodSyncResults(null);
    try {
      const results = await syncAllVod();
      setVodSyncResults(results);
    } catch (err) {
      console.error('VOD sync error:', err);
    } finally {
      setVodSyncing(false);
    }
  }

  return (
    <div className="settings-tab-content">
      {/* Sources List */}
      <div className="settings-section">
        <div className="section-header">
          <h3>Sources</h3>
          <div className="section-actions">
            <button
              className="sync-btn"
              onClick={handleSync}
              disabled={syncing || sources.length === 0}
            >
              {syncing ? 'Syncing...' : 'Sync Channels'}
            </button>
            <button
              className="sync-btn"
              onClick={handleVodSync}
              disabled={vodSyncing || !hasXtreamSource}
            >
              {vodSyncing ? 'Syncing...' : 'Sync Movies & Series'}
            </button>
            <button className="add-btn" onClick={handleAdd}>+ Add Source</button>
          </div>
        </div>

        {/* Sync Status */}
        {syncStatus.length > 0 && (
          <div className="sync-status">
            {syncStatus.map((status) => {
              const source = sources.find((s) => s.id === status.source_id);
              return (
                <div key={status.source_id} className={`sync-status-item ${status.error ? 'error' : 'success'}`}>
                  <span className="status-name">{source?.name || status.source_id}</span>
                  {status.error ? (
                    <span className="status-error">{status.error}</span>
                  ) : (
                    <span className="status-count">{status.channel_count} channels</span>
                  )}
                  {status.last_synced && (
                    <span className="status-time">
                      {new Date(status.last_synced).toLocaleTimeString()}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* VOD Sync Results */}
        {vodSyncResults && vodSyncResults.size > 0 && (
          <div className="sync-status">
            {Array.from(vodSyncResults.entries()).map(([sourceId, result]) => {
              const source = sources.find((s) => s.id === sourceId);
              return (
                <div key={sourceId} className={`sync-status-item ${result.error ? 'error' : 'success'}`}>
                  <span className="status-name">{source?.name || sourceId}</span>
                  {result.error ? (
                    <span className="status-error">{result.error}</span>
                  ) : (
                    <span className="status-count">
                      {result.movieCount} movies, {result.seriesCount} series
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {sources.length === 0 ? (
          <div className="empty-state">
            <p>No sources configured</p>
            <p className="hint">Add an M3U playlist or Xtream account to get started</p>
          </div>
        ) : (
          <ul className="sources-list">
            {sources.map((source) => (
              <li key={source.id} className="source-item">
                <div className="source-info">
                  <span className="source-name">{source.name}</span>
                  <span className="source-type">{source.type.toUpperCase()}</span>
                </div>
                <div className="source-actions">
                  <button onClick={() => handleEdit(source)}>Edit</button>
                  <button className="delete" onClick={() => handleDelete(source.id, source.name)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Add/Edit Form */}
      {showAddForm && createPortal(
        <div className="source-form-overlay">
          <form className="source-form" onSubmit={handleSubmit}>
            <h3>{editingId ? 'Edit Source' : 'Add Source'}</h3>

            {error && <div className="form-error">{error}</div>}

            <div className="form-group">
              <label>Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="My IPTV Provider"
              />
            </div>

            <div className="form-group">
              <label>Type</label>
              <div className="type-selector">
                <button
                  type="button"
                  className={formData.type === 'm3u' ? 'active' : ''}
                  onClick={() => setFormData({ ...formData, type: 'm3u' })}
                >
                  M3U Playlist
                </button>
                <button
                  type="button"
                  className={formData.type === 'xtream' ? 'active' : ''}
                  onClick={() => setFormData({ ...formData, type: 'xtream' })}
                >
                  Xtream Codes
                </button>
              </div>
            </div>

            <div className="form-group">
              <label>{formData.type === 'm3u' ? 'Playlist URL' : 'Server URL'}</label>
              <input
                type="text"
                value={formData.url}
                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                placeholder={formData.type === 'm3u' ? 'http://example.com/playlist.m3u' : 'http://provider.com:8080'}
              />
            </div>

            {formData.type === 'xtream' && (
              <>
                <div className="form-group">
                  <label>Username</label>
                  <input
                    type="text"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    placeholder="username"
                  />
                </div>
                <div className="form-group">
                  <label>Password</label>
                  <input
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder="password"
                  />
                </div>
                {!isEncryptionAvailable && (
                  <div className="inline-warning">
                    Warning: Password will be stored without encryption
                  </div>
                )}
              </>
            )}

            {/* EPG Settings */}
            <div className="form-group epg-settings">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={formData.autoLoadEpg}
                  onChange={(e) => setFormData({ ...formData, autoLoadEpg: e.target.checked })}
                />
                Auto-load EPG from source
              </label>
              <span className="hint">
                {formData.type === 'xtream'
                  ? 'Uses provider\'s XMLTV endpoint'
                  : 'Uses url-tvg from M3U header if available'}
              </span>
            </div>

            {!formData.autoLoadEpg && (
              <div className="form-group">
                <label>EPG URL (optional)</label>
                <input
                  type="text"
                  value={formData.epgUrl}
                  onChange={(e) => setFormData({ ...formData, epgUrl: e.target.value })}
                  placeholder="http://example.com/epg.xml"
                />
                <span className="hint">XMLTV format EPG URL</span>
              </div>
            )}

            <div className="form-actions">
              <button type="button" className="cancel-btn" onClick={handleCancel}>
                Cancel
              </button>
              <button type="submit" className="save-btn">
                {editingId ? 'Save Changes' : 'Add Source'}
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}
    </div>
  );
}
