import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { Source } from '../../types/electron';
import { syncAllSources, syncAllVod, markSourceDeleted } from '../../db/sync';
import { clearSourceData, clearVodData, db } from '../../db';
import { useSyncStatus } from '../../hooks/useChannels';
import { useChannelSyncing, useSetChannelSyncing, useVodSyncing, useSetVodSyncing, useUIStore, useUpdateSettings } from '../../stores/uiStore';
import { parseM3U } from '@sbtltv/local-adapter';

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
  const [syncError, setSyncError] = useState<string | null>(null);
  const syncStatus = useSyncStatus();

  // Global sync state - persists across Settings open/close
  const syncing = useChannelSyncing();
  const setSyncing = useSetChannelSyncing();
  const vodSyncing = useVodSyncing();
  const setVodSyncing = useSetVodSyncing();

  const hasXtreamSource = sources.some(s => s.type === 'xtream');
  const updateSettings = useUpdateSettings();

  async function handleToggleEnabled(source: Source) {
    if (!window.storage) return;
    const updated = { ...source, enabled: !source.enabled };
    await window.storage.saveSource(updated);
    useUIStore.getState().updateSource(updated);
    onSourcesChange();
  }

  // Track imported M3U data (file import flow)
  const [importedM3U, setImportedM3U] = useState<{
    channels: number;
    categories: number;
    epgUrl?: string;
    rawContent: string;
  } | null>(null);

  function handleAdd() {
    setFormData(emptyForm);
    setEditingId(null);
    setImportedM3U(null);
    setShowAddForm(true);
    setError(null);
  }

  async function handleImportM3U() {
    if (!window.storage) return;

    const result = await window.storage.importM3UFile();
    if (result.canceled || !result.data) return;

    const { content, fileName } = result.data;

    // Parse to validate and extract info
    const tempSourceId = 'temp-import';
    const parsed = parseM3U(content, tempSourceId);

    setImportedM3U({
      channels: parsed.channels.length,
      categories: parsed.categories.length,
      epgUrl: parsed.epgUrl ?? undefined,
      rawContent: content,
    });

    setFormData({
      ...emptyForm,
      name: fileName,
      type: 'm3u',
      url: '', // No URL for file imports
      autoLoadEpg: !!parsed.epgUrl,
      epgUrl: parsed.epgUrl ?? '',
    });

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

    // Mark source as deleted FIRST - prevents sync from writing results after deletion
    markSourceDeleted(id);

    // Clean up all data in IndexedDB before removing source config
    await clearSourceData(id);
    await clearVodData(id);
    await window.storage.deleteSource(id);

    // Clean deleted source from priority order lists
    const { liveSourceOrder: lso, vodSourceOrder: vso } = useUIStore.getState().settings;
    const cleanedLive = lso?.filter(sid => sid !== id);
    const cleanedVod = vso?.filter(sid => sid !== id);
    if (cleanedLive) {
      updateSettings({ liveSourceOrder: cleanedLive });
      window.storage?.updateSettings({ liveSourceOrder: cleanedLive });
    }
    if (cleanedVod) {
      updateSettings({ vodSourceOrder: cleanedVod });
      window.storage?.updateSettings({ vodSourceOrder: cleanedVod });
    }

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
    // URL is required unless this is a file import
    if (!importedM3U && !formData.url.trim()) {
      setError('URL is required');
      return;
    }
    if (formData.type === 'xtream' && (!formData.username.trim() || !formData.password.trim())) {
      setError('Username and password are required for Xtream');
      return;
    }

    const sourceId = editingId || crypto.randomUUID();

    const source: Source = {
      id: sourceId,
      name: formData.name.trim(),
      type: formData.type,
      url: importedM3U ? `imported:${formData.name.trim()}` : formData.url.trim(),
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

    // Append new source to priority order lists (only for new sources, not edits)
    if (!editingId) {
      const { liveSourceOrder: lso, vodSourceOrder: vso } = useUIStore.getState().settings;
      if (lso && lso.length > 0) {
        const newLive = [...lso, sourceId];
        updateSettings({ liveSourceOrder: newLive });
        window.storage?.updateSettings({ liveSourceOrder: newLive });
      }
      if (source.type === 'xtream' && vso && vso.length > 0) {
        const newVod = [...vso, sourceId];
        updateSettings({ vodSourceOrder: newVod });
        window.storage?.updateSettings({ vodSourceOrder: newVod });
      }
    }

    // For file imports, store channels directly in the database
    if (importedM3U) {
      const parsed = parseM3U(importedM3U.rawContent, sourceId);

      await db.transaction('rw', [db.channels, db.categories, db.sourcesMeta], async () => {
        if (parsed.channels.length > 0) {
          await db.channels.bulkPut(parsed.channels);
        }
        if (parsed.categories.length > 0) {
          await db.categories.bulkPut(parsed.categories);
        }
        await db.sourcesMeta.put({
          source_id: sourceId,
          epg_url: parsed.epgUrl ?? undefined,
          last_synced: new Date(),
          channel_count: parsed.channels.length,
          category_count: parsed.categories.length,
        });
      });
    }

    setShowAddForm(false);
    setFormData(emptyForm);
    setEditingId(null);
    setImportedM3U(null);
    onSourcesChange();
  }

  function handleCancel() {
    setShowAddForm(false);
    setFormData(emptyForm);
    setEditingId(null);
    setImportedM3U(null);
    setError(null);
  }

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    try {
      await syncAllSources();
    } catch (err) {
      console.error('Sync error:', err);
      setSyncError(err instanceof Error ? err.message : 'Channel sync failed');
    } finally {
      setSyncing(false);
    }
  }

  async function handleVodSync() {
    setVodSyncing(true);
    setSyncError(null);
    try {
      await syncAllVod();
    } catch (err) {
      console.error('VOD sync error:', err);
      setSyncError(err instanceof Error ? err.message : 'VOD sync failed');
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

        {syncError && (
          <div className="sync-error">{syncError}</div>
        )}

        {sources.length === 0 ? (
          <div className="empty-state">
            <p>No sources configured</p>
            <p className="hint">Add an M3U playlist or Xtream account to get started</p>
          </div>
        ) : (
          <ul className="sources-list">
            {sources.map((source) => {
              const meta = syncStatus.find(s => s.source_id === source.id);
              const parts: string[] = [];
              if (meta?.channel_count) parts.push(`${meta.channel_count.toLocaleString()} channels`);
              if (meta?.vod_movie_count) parts.push(`${meta.vod_movie_count.toLocaleString()} movies`);
              if (meta?.vod_series_count) parts.push(`${meta.vod_series_count.toLocaleString()} series`);
              return (
                <li key={source.id} className={`source-item${source.enabled ? '' : ' disabled'}`}>
                  <div className="source-row">
                    <div className="source-info">
                      <label className="source-toggle" title={source.enabled ? 'Disable source' : 'Enable source'}>
                        <input
                          type="checkbox"
                          checked={source.enabled}
                          onChange={() => handleToggleEnabled(source)}
                        />
                        <span className="toggle-slider" />
                      </label>
                      <span className="source-name">{source.name}</span>
                      <span className="source-type">{source.type.toUpperCase()}</span>
                    </div>
                    <div className="source-actions">
                      <button onClick={() => handleEdit(source)}>Edit</button>
                      <button className="delete" onClick={() => handleDelete(source.id, source.name)}>Delete</button>
                    </div>
                  </div>
                  {(parts.length > 0 || meta?.error || meta?.last_synced) && (
                    <div className="source-detail">
                      {meta?.error ? (
                        <span className="source-error">{meta.error}</span>
                      ) : (
                        <>
                          {parts.length > 0 && <span className="source-stats">{parts.join(' · ')}</span>}
                          {meta?.last_synced && (
                            <span className="source-synced">Synced {new Date(meta.last_synced).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
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

            {/* Type selector - hidden for file imports */}
            {!importedM3U && (
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
            )}

            {/* URL field for Xtream sources */}
            {formData.type === 'xtream' && (
              <div className="form-group">
                <label>Server URL</label>
                <input
                  type="text"
                  value={formData.url}
                  onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                  placeholder="http://provider.com:8080"
                />
              </div>
            )}

            {/* M3U: URL or File import */}
            {formData.type === 'm3u' && !importedM3U && (
              <div className="form-group">
                <label>Playlist URL</label>
                <input
                  type="text"
                  value={formData.url}
                  onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                  placeholder="http://example.com/playlist.m3u"
                />
                <div className="or-divider">
                  <span>or</span>
                </div>
                <button
                  type="button"
                  className="import-btn"
                  onClick={handleImportM3U}
                >
                  Import from File...
                </button>
              </div>
            )}

            {/* Import info for file imports */}
            {formData.type === 'm3u' && importedM3U && (
              <div className="form-group import-info">
                <label>Imported File</label>
                <div className="import-summary">
                  <span>{importedM3U.channels} channels</span>
                  <span>{importedM3U.categories} categories</span>
                  {importedM3U.epgUrl && <span>EPG URL detected</span>}
                </div>
                <button
                  type="button"
                  className="change-file-btn"
                  onClick={() => setImportedM3U(null)}
                >
                  Use URL instead
                </button>
              </div>
            )}

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
