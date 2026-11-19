import { useEffect, useState } from 'react';
import type { SyncParts, SyncView } from '../../types/electron';
import { useUIStore } from '../../stores/uiStore';
import { saveSettings } from '../../utils/saveSettings';
import { ago } from '../../utils/ago';
import { AddComputerPanel } from './AddComputerPanel';
import { Button, Hint, OnOff, OptionRow, Section, Segmented, TextField } from './ui';
import './SyncSection.css';

/** "Mac", "Mac and Linux PC", "Mac, Linux PC and Windows PC" */
const names = (list: string[]) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0] ?? '');

const PROBLEM: Partial<Record<SyncView['status'], string>> = {
  removed: 'This computer was removed from sync. To come back, add it again from another computer.',
  ended: 'Sync ended (unused for 90 days). Add a computer to start again.',
  keyring: 'Sync needs your keyring on this computer. Leave sync, then add it again from another computer.',
  update: 'Update sbtlTV to keep syncing.',
};

/**
 * Settings > Sync & transfer > Sync: the user's own computers. Nothing is stored anywhere until a
 * second computer joins. Opening Add a computer closes the other knock panels (one knock at a time).
 */
export function SyncSection({ adding, onAdding }: { adding: boolean; onAdding: (open: boolean) => void }) {
  const [view, setView] = useState<SyncView | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const missing = useUIStore((s) => s.settings.syncMissingTitles ?? 'gray');
  const missingChannels = useUIStore((s) => s.settings.syncMissingChannels ?? 'hide');
  const updateSettings = useUIStore((s) => s.updateSettings);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!window.sync) return;
    void window.sync.view().then(setView);
    const off = window.sync.onView(setView);
    const id = window.setInterval(() => tick((n) => n + 1), 30_000);   // keeps "2 minutes ago" true
    return () => { off(); window.clearInterval(id); };
  }, []);

  if (!view || !window.sync) return null;
  const sync = window.sync;
  const on = view.status === 'active';
  const problem = PROBLEM[view.status];
  const setPart = (p: keyof SyncParts, value: boolean) => void sync.setParts({ ...view.parts, [p]: value });
  const run = async (f: () => Promise<{ error?: string }>) => { setError(null); const r = await f(); if (r.error) setError(r.error); };

  return (
    <Section
      title="Sync"
      description="Keep your watchlist, progress and favorite channels in step on your own computers. End-to-end encrypted: even we can't read it."
      actions={<Button onClick={() => onAdding(!adding)} aria-expanded={adding} disabled={view.status === 'keyring' || view.status === 'update'}>Add a computer…</Button>}
    >
      {adding && <AddComputerPanel onClose={() => onAdding(false)} />}
      {problem && <Hint tone="warn">{problem}</Hint>}
      {view.interrupted.length > 0 && (
        <div className="knock-panel__actions">
          <Hint tone="warn">Sync was interrupted. Add {names(view.interrupted)} again.</Hint>
          <Button onClick={() => void sync.dismissInterrupted()}>Dismiss</Button>
        </div>
      )}
      {view.status === 'off' && !adding && <Hint>On the other computer: Sync & transfer › Show my code.</Hint>}
      {view.status === 'pending' && <Hint>Waiting for the other computer to join…</Hint>}
      {on && (
        <>
          <Hint>{view.lastSync ? `Last synced ${ago(view.lastSync)}.` : 'Not synced yet.'}</Hint>
          <OptionRow title="Watchlist"><OnOff label="Watchlist" value={view.parts.watchlist} onChange={(v) => setPart('watchlist', v)} /></OptionRow>
          <OptionRow title="Watch progress" help="Resume points and finished marks"><OnOff label="Watch progress" value={view.parts.progress} onChange={(v) => setPart('progress', v)} /></OptionRow>
          <OptionRow title="Favorites" help="Channel favorites, where this computer has the channel."><OnOff label="Favorites" value={view.parts.favorites} onChange={(v) => setPart('favorites', v)} /></OptionRow>
          <OptionRow title="Settings" help="Look, subtitles and players. Turning it on takes your other computers' settings.">
            <OnOff label="Settings" value={view.parts.settings} onChange={(v) => setPart('settings', v)} />
          </OptionRow>
          <OptionRow title="Titles this computer doesn't have" help="In Continue Watching and your watchlist.">
            <Segmented
              value={missing}
              label="Titles this computer doesn't have"
              options={[{ id: 'gray', label: 'Gray out' }, { id: 'hide', label: 'Hide' }]}
              onChange={(v) => { updateSettings({ syncMissingTitles: v }); void saveSettings({ syncMissingTitles: v }); }}
            />
          </OptionRow>
          <OptionRow title="Channels this computer doesn't have" help="Favorites from your other computers with no match here. Gray out lists them last in the Guide's Favorites.">
            <Segmented
              value={missingChannels}
              label="Channels this computer doesn't have"
              options={[{ id: 'gray', label: 'Gray out' }, { id: 'hide', label: 'Hide' }]}
              onChange={(v) => { updateSettings({ syncMissingChannels: v }); void saveSettings({ syncMissingChannels: v }); }}
            />
          </OptionRow>
          <div className="sync-computers" role="list" aria-label="Computers">
            <div className="sync-computers__title">Computers</div>
            {view.computers.map((c) => (
              <div key={c.id} className="sync-computers__row" role="listitem">
                {c.thisOne && renaming !== null ? (
                  <form className="sync-computers__rename" onSubmit={(e) => { e.preventDefault(); void sync.rename(renaming); setRenaming(null); }}>
                    <TextField autoFocus aria-label="Name this computer" value={renaming} maxLength={40} onChange={(e) => setRenaming(e.target.value)} />
                    <Button type="submit" variant="primary" disabled={!renaming.trim()}>Save</Button>
                    <Button onClick={() => setRenaming(null)}>Cancel</Button>
                  </form>
                ) : (
                  <>
                    <div className="sync-computers__name">
                      {c.name}
                      <span className="sync-computers__seen">{c.thisOne ? 'This one' : c.lastSeen ? `Last seen ${ago(c.lastSeen)}` : ''}</span>
                    </div>
                    {c.thisOne
                      ? <Button onClick={() => setRenaming(c.name)}>Rename</Button>
                      : removing === c.id
                        ? (
                          <div className="sync-computers__confirm">
                            <span>Remove {c.name}? To bring it back, add it again.</span>
                            <Button variant="danger" onClick={() => { setRemoving(null); void run(() => sync.remove(c.id)); }}>Remove</Button>
                            <Button onClick={() => setRemoving(null)}>Cancel</Button>
                          </div>
                        )
                        : <Button onClick={() => setRemoving(c.id)}>Remove</Button>}
                  </>
                )}
              </div>
            ))}
            <Hint>Removing a computer changes the lock, so it can't read anything new.</Hint>
          </div>
        </>
      )}
      {error && <Hint tone="danger">{error}</Hint>}
      {(on || view.status === 'keyring' || view.status === 'pending' || view.status === 'removed' || view.status === 'ended') && (
        leaving ? (
          <div className="knock-panel__actions">
            <Hint>Leave sync? This computer keeps its lists.</Hint>
            <Button variant="danger" onClick={() => { setLeaving(false); void run(() => sync.leave()); }}>Leave</Button>
            <Button onClick={() => setLeaving(false)}>Cancel</Button>
          </div>
        ) : (
          <div className="knock-panel__actions"><Button onClick={() => setLeaving(true)}>{view.status === 'pending' ? 'Stop waiting' : 'Leave sync'}</Button></div>
        )
      )}
    </Section>
  );
}
