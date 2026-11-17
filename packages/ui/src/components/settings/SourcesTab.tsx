import { useState } from 'react';
import type { Source } from '../../types/electron';
import { data } from '../../data/client';
import { useSyncStatus } from '../../hooks/useChannels';
import { useChannelSyncing, useVodSyncing, useUIStore, useUpdateSettings } from '../../stores/uiStore';
import { needsLogin } from '@sbtltv/core';
import { useToast } from '../../hooks/useToast';
import { Button, Hint, Section, SettingsTab } from './ui';
import { SourceForm } from './SourceForm';

interface SourcesTabProps {
  sources: Source[];
  isEncryptionAvailable: boolean;
  onSourcesChange: () => void;
}

export function SourcesTab({ sources, isEncryptionAvailable, onSourcesChange }: SourcesTabProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingSource, setEditingSource] = useState<Source | null>(null);
  const toast = useToast();
  const [syncError, setSyncError] = useState<string | null>(null);
  const syncStatus = useSyncStatus();

  // Global sync state - persists across Settings open/close
  const syncing = useChannelSyncing();
  const vodSyncing = useVodSyncing();

  const hasXtreamSource = sources.some(s => s.type === 'xtream');
  const updateSettings = useUpdateSettings();

  async function handleToggleEnabled(source: Source) {
    if (!window.storage) return;
    const updated = { ...source, enabled: !source.enabled };
    await window.storage.saveSource(updated);
    useUIStore.getState().updateSource(updated);
    onSourcesChange();
  }

  function handleAdd() {
    setEditingSource(null);
    setShowAddForm(true);
  }

  function handleEdit(source: Source) {
    setEditingSource(source);
    setShowAddForm(true);
  }

  async function handleDelete(id: string, sourceName: string) {
    if (!window.storage) return;

    const confirmed = window.confirm(
      `Delete "${sourceName}"?\n\nThis will remove all channels, EPG, and VOD data from this source.`
    );
    if (!confirmed) return;

    const p = toast.progress(`Removing ${sourceName}…`);
    const startedAt = Date.now();
    try {
      // Main pushes the new source list to the data process, which drops the rows.
      const result = await window.storage.deleteSource(id);
      if (result.error) throw new Error(result.error); // soft IPC error — surface as a failure

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
      // Keep the branded loader visible briefly even when the purge is near-instant.
      const elapsed = Date.now() - startedAt;
      if (elapsed < 500) await new Promise((r) => setTimeout(r, 500 - elapsed));
      p.succeed(`Removed ${sourceName}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      p.fail(`Couldn't remove ${sourceName}`, msg);
    }
  }

  // The data process runs the sync; the banner follows its progress events (App.tsx).
  async function handleSync() {
    setSyncError(null);
    try {
      await data.query({ type: 'syncNow', what: 'channels' });
    } catch (err) {
      console.error('Sync error:', err);
      setSyncError(err instanceof Error ? err.message : 'Channel sync failed');
    }
  }

  async function handleVodSync() {
    setSyncError(null);
    try {
      await data.query({ type: 'syncNow', what: 'vod' });
    } catch (err) {
      console.error('VOD sync error:', err);
      setSyncError(err instanceof Error ? err.message : 'VOD sync failed');
    }
  }

  return (
    <SettingsTab>
      <Section
        title="Sources"
        description="Your M3U playlists and Xtream accounts. Turn one off to hide its channels without deleting it."
        actions={
          <>
            <Button onClick={handleSync} disabled={syncing || sources.length === 0}>
              {syncing ? 'Syncing…' : 'Sync channels'}
            </Button>
            <Button onClick={handleVodSync} disabled={vodSyncing || !hasXtreamSource}>
              {vodSyncing ? 'Syncing…' : 'Sync movies & series'}
            </Button>
            <Button variant="primary" onClick={handleAdd}>Add source</Button>
          </>
        }
      >
        {syncError && <Hint tone="danger">{syncError}</Hint>}

        {sources.length === 0 ? (
          <Hint>No sources yet. Add an M3U playlist or an Xtream account to start watching.</Hint>
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
                      <span className="source-type">{source.type === 'xtream' ? 'Xtream' : 'M3U'}</span>
                    </div>
                    <div className="source-actions">
                      <Button className="st-btn--small" onClick={() => handleEdit(source)}>Edit</Button>
                      <Button className="st-btn--small" variant="danger" onClick={() => handleDelete(source.id, source.name)}>Delete</Button>
                    </div>
                  </div>
                  {(parts.length > 0 || meta?.error || meta?.last_synced || needsLogin(source)) && (
                    <div className="source-detail">
                      {needsLogin(source) ? (
                        <span className="source-error">Login needed: edit this source and enter its password.</span>
                      ) : meta?.error ? (
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
      </Section>


      {showAddForm && (
        <SourceForm
          editing={editingSource}
          layout="overlay"
          isEncryptionAvailable={isEncryptionAvailable}
          onDone={(saved) => { setShowAddForm(false); setEditingSource(null); if (saved) onSourcesChange(); }}
        />
      )}
    </SettingsTab>
  );
}
