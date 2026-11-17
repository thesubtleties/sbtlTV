import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Source } from '../../types/electron';
import { data } from '../../data/client';
import { useUIStore, useUpdateSettings } from '../../stores/uiStore';
import { parseM3U } from '@sbtltv/local-adapter';
import { useToast } from '../../hooks/useToast';
import { Button, Segmented } from './ui';

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

function formFromSource(source: Source): SourceFormData {
  return {
    name: source.name,
    type: source.type === 'xtream' ? 'xtream' : 'm3u',
    url: source.url,
    username: source.username || '',
    password: source.password || '',
    autoLoadEpg: source.auto_load_epg ?? (source.type === 'xtream'),
    epgUrl: source.epg_url || '',
  };
}

/**
 * Add or edit a source: an overlay in Settings › Sources, inline in the first-run setup.
 * onDone(source) after a save, onDone(null) on Cancel; a failed save shows its error and stays open.
 * Inline has no buttons of its own: the setup's Continue submits it (formId).
 */
export function SourceForm({ editing, layout, isEncryptionAvailable, formId, onDone }: {
  editing: Source | null;
  layout: 'overlay' | 'inline';
  isEncryptionAvailable: boolean;
  formId?: string;
  onDone: (saved: Source | null) => void;
}) {
  const [formData, setFormData] = useState<SourceFormData>(() => (editing ? formFromSource(editing) : emptyForm));
  const [error, setError] = useState<string | null>(null);
  // A save in progress (a big playlist import takes seconds): a second Continue/Enter must not add it twice
  const savingRef = useRef(false);
  const editingId = editing?.id ?? null;
  const toast = useToast();
  const updateSettings = useUpdateSettings();

  // Track imported M3U data (file import flow)
  const [importedM3U, setImportedM3U] = useState<{
    channels: number;
    categories: number;
    epgUrl?: string;
    rawContent: string;
  } | null>(null);

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

    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!window.storage || savingRef.current) return;
    savingRef.current = true;
    try {
      await submit();
    } finally {
      savingRef.current = false;
    }
  }

  async function submit() {

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

    const result = await window.storage!.saveSource(source);
    if (result.error) {
      setError(result.error);
      return;
    }

    // Append new source to priority order lists (only for new sources, not edits)
    if (!editingId) {
      toast.success(`Added ${source.name}`);
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

    // For file imports, hand the playlist to the data process (there is no URL to fetch)
    if (importedM3U) {
      await data.query({ type: 'importPlaylist', sourceId, content: importedM3U.rawContent });
    }

    onDone(source);
  }

  const form = (
      <form id={formId} className={`source-form${layout === 'inline' ? ' source-form--inline' : ''}`} onSubmit={handleSubmit}>
        {layout === 'overlay' && <h3>{editingId ? 'Edit source' : 'Add source'}</h3>}

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
            <Segmented
              value={formData.type}
              options={[{ id: 'm3u', label: 'M3U playlist' }, { id: 'xtream', label: 'Xtream Codes' }]}
              onChange={(type) => setFormData({ ...formData, type })}
            />
          </div>
        )}

        {/* URL field for Xtream sources */}
        {formData.type === 'xtream' && (
          <div className="form-group">
            <label>Server address</label>
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
            <label>Playlist address</label>
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
              Import from file…
            </button>
          </div>
        )}

        {/* Import info for file imports */}
        {formData.type === 'm3u' && importedM3U && (
          <div className="form-group import-info">
            <label>Imported file</label>
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
                No keyring available, so this password will be stored unencrypted.
              </div>
            )}
          </>
        )}

        {/* EPG Settings */}
        <div className="form-group epg-settings">
          <label>Program guide</label>
          <Segmented
            value={formData.autoLoadEpg ? 'auto' : 'url'}
            options={[{ id: 'auto', label: 'From the source' }, { id: 'url', label: 'Own address' }]}
            onChange={(mode) => setFormData({ ...formData, autoLoadEpg: mode === 'auto' })}
          />
          <span className="hint">
            {formData.autoLoadEpg
              ? formData.type === 'xtream'
                ? "Uses the provider's XMLTV guide."
                : "Uses the url-tvg address in the playlist's header, when it has one."
              : 'Enter an XMLTV guide address below, or leave it empty for no guide.'}
          </span>
        </div>

        {!formData.autoLoadEpg && (
          <div className="form-group">
            <label>Guide address (XMLTV)</label>
            <input
              type="text"
              value={formData.epgUrl}
              onChange={(e) => setFormData({ ...formData, epgUrl: e.target.value })}
              placeholder="http://example.com/epg.xml"
            />
          </div>
        )}

        {layout === 'overlay' && (
          <div className="form-actions">
            <Button onClick={() => onDone(null)}>Cancel</Button>
            <Button type="submit" variant="primary">{editingId ? 'Save changes' : 'Add source'}</Button>
          </div>
        )}
      </form>
  );
  return layout === 'overlay'
    ? createPortal(<div className="source-form-overlay">{form}</div>, document.body)
    : form;
}
