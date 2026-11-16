import './BackupTransferTab.css';
import { useEffect, useState } from 'react';
import type { SetupPart, SetupPreview } from '../../types/electron';
import { useUIStore } from '../../stores/uiStore';
import { readLists, replaceLists, type ListPart } from '../../services/setup/lists';
import { rebuildFilePlaylists } from '../../services/setup/filePlaylists';
import { setupSummary } from '../../services/setup/summary';
import { receivedNote } from '../../utils/receivedNote';
import { Button, Hint, OnOff, OptionRow, Section, SettingsTab, TextField } from './ui';
import { SendSetupPanel } from './SendSetupPanel';
import { ReceiveSetupPanel } from './ReceiveSetupPanel';

const EXPORT_PARTS: { id: SetupPart; title: string; help?: string; defaultOn: boolean }[] = [
  { id: 'sources', title: 'Sources', defaultOn: true },
  { id: 'logins', title: 'With logins', help: "Xtream passwords. M3U logins are part of their addresses, so they always go along.", defaultOn: true },
  { id: 'settings', title: 'Settings', defaultOn: true },
  { id: 'apiKeys', title: 'API keys', help: 'TMDB, RatingPosterDB and SubDL.', defaultOn: true },
  { id: 'favorites', title: 'Favorites', defaultOn: true },
  { id: 'watchlist', title: 'Watchlist', defaultOn: true },
  { id: 'progress', title: 'Watch progress', defaultOn: false },
];
const LIST_PARTS: ListPart[] = ['favorites', 'watchlist', 'progress'];
const PLATFORMS: Record<string, string> = { linux: 'Linux', darwin: 'macOS', win32: 'Windows' };
const platformName = (p: string) => PLATFORMS[p] ?? p;
function exportedOn(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `, ${d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
}

type ImportState =
  | { step: 'idle' }
  | { step: 'passphrase'; token: string; error?: string }
  | { step: 'preview'; token: string; preview: SetupPreview; restoring?: boolean; received?: boolean }
  | { step: 'applying' }
  | { step: 'failed'; error: string; backupName: string | null };

/** The last export, kept by Settings while it is open (switching tabs keeps it; closing Settings clears it). */
export interface LastExport { passphrase: string; filePath: string }

export function BackupTransferTab({ lastExport, onExported, autoReceive, onAutoReceiveUsed }: { lastExport: LastExport | null; onExported: (e: LastExport) => void; autoReceive?: boolean; onAutoReceiveUsed?: () => void }) {
  const sources = useUIStore((s) => s.sources);
  const [parts, setParts] = useState(() => new Set(EXPORT_PARTS.filter((p) => p.defaultOn).map((p) => p.id)));
  const [exporting, setExporting] = useState(false);
  const exported = lastExport;
  const [exportError, setExportError] = useState<string | null>(null);
  const [imp, setImp] = useState<ImportState>({ step: 'idle' });
  const [passphrase, setPassphrase] = useState('');
  const [copied, setCopied] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [backupFirst, setBackupFirst] = useState(true);
  const [backups, setBackups] = useState<{ name: string; label: string }[]>([]);
  // Transfer: one of export or send open at a time (an export just made stays open). Receive: the code panel.
  const [transfer, setTransfer] = useState<'none' | 'export' | 'send'>(lastExport ? 'export' : 'none');
  const [receiving, setReceiving] = useState(!!autoReceive);
  // "Receive a setup" opens the code once; coming back to this tab later doesn't start another
  useEffect(() => { if (autoReceive) onAutoReceiveUsed?.(); }, [autoReceive, onAutoReceiveUsed]);
  // One knock at a time: opening Send closes Receive and the other way round
  const openSend = () => { setReceiving(false); setTransfer(transfer === 'send' ? 'none' : 'send'); };
  const openReceive = () => { if (!receiving && transfer === 'send') setTransfer('none'); setReceiving(!receiving); };

  useEffect(() => { void window.setup?.backups().then((r) => setBackups(r.data)); }, []);

  const toggle = (id: SetupPart, on: boolean) => setParts((prev) => {
    const next = new Set(prev);
    if (on) next.add(id); else next.delete(id);
    if (id === 'sources') { if (on) next.add('logins'); else next.delete('logins'); }
    return next;
  });

  async function exportSetup() {
    if (!window.setup) return;
    setExporting(true); setExportError(null);
    try {
      const chosen = [...parts];
      const lists = await readLists(LIST_PARTS.filter((p) => parts.has(p)), parts.has('settings'));
      const playlists = parts.has('sources') ? await rebuildFilePlaylists(sources) : {};
      const r = await window.setup.exportSetup({ parts: chosen, lists, playlists });
      if ('error' in r) setExportError(r.error);
      else if (r.success) { onExported(r.data); setCopied(false); }
    } catch (error) {
      setExportError(`The export didn't finish: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setExporting(false);
    }
  }

  async function pick() {
    if (!window.setup) return;
    const r = await window.setup.pick();
    if ('error' in r) return setImp({ step: 'failed', error: r.error, backupName: null });
    if (!r.success) return;
    if (r.data.needsPassphrase) { setPassphrase(''); setImp({ step: 'passphrase', token: r.data.token }); return; }
    const u = await window.setup.unlock(r.data.token, '');
    if ('error' in u) setImp({ step: 'failed', error: u.error, backupName: null });
    else if (u.success) setImp({ step: 'preview', token: r.data.token, preview: u.data });
  }

  async function unlock(token: string) {
    setUnlocking(true);
    const u = await window.setup!.unlock(token, passphrase).finally(() => setUnlocking(false));
    if ('error' in u) setImp({ step: 'passphrase', token, error: u.error });
    else if (u.success) setImp({ step: 'preview', token, preview: u.data });
  }

  async function openBackup(name: string) {
    const r = await window.setup!.openBackup(name);
    if ('error' in r) setImp({ step: 'failed', error: r.error, backupName: null });
    else if (r.success) setImp({ step: 'preview', token: r.data.token, preview: r.data.preview, restoring: true });
  }

  async function apply(token: string, withBackup = backupFirst) {
    setImp({ step: 'applying' });
    let backupName: string | null = null;
    try {
      const currentLists = withBackup ? await readLists(LIST_PARTS, true) : {};
      const currentPlaylists = withBackup ? await rebuildFilePlaylists(sources) : {};
      const r = await window.setup!.apply(token, { backupFirst: withBackup, currentLists, currentPlaylists });
      if ('error' in r) return setImp({ step: 'failed', error: r.error, backupName: 'backupName' in r ? r.backupName : null });
      if (!r.success) return setImp({ step: 'idle' });
      backupName = r.data.backupName;
      if (r.data.lists) await replaceLists(r.data.lists);   // null: a received setup leaves the lists alone
      await window.setup!.relaunch();
    } catch (error) {
      setImp({ step: 'failed', error: error instanceof Error ? error.message : String(error), backupName });
    }
  }

  // After a failed import: put the backup back in one step (no new backup of the half-imported state).
  async function restoreNow(name: string) {
    const r = await window.setup!.openBackup(name);
    if ('error' in r) return setImp({ step: 'failed', error: r.error, backupName: null });
    if (r.success) await apply(r.data.token, false);
  }

  // Export crashed a Windows portable install (not reproducible here); export and import stay in the installed version
  if (window.platform?.isPortable) {
    return (
      <SettingsTab>
        <Section title="Sync & transfer"
          description={<>Not in the portable version. Install sbtlTV to export or import your setup; it also keeps itself up to date. <a href="https://github.com/thesubtleties/sbtlTV/releases/latest" target="_blank" rel="noopener noreferrer">Download</a></>} />
      </SettingsTab>
    );
  }

  return (
    <SettingsTab>
      <Section title="Transfer setup" description="To another computer, or someone else's."
        actions={<>
          <Button onClick={openSend} disabled={imp.step === 'applying'}>Send to a device…</Button>
          <Button onClick={() => setTransfer(transfer === 'export' ? 'none' : 'export')} disabled={imp.step === 'applying'}>Export to file…</Button>
        </>}>
        {transfer === 'send' && <SendSetupPanel onClose={() => setTransfer('none')} />}
        {transfer === 'export' && <>
        <Hint>One file, locked with a passphrase.</Hint>
        {/* Above the choices: on a short screen it would land out of sight */}
        {exported && (
          <div className="setup-passphrase">
            <div className="setup-passphrase__label">Passphrase for {exported.filePath.split(/[\\/]/).pop()}</div>
            <div className="setup-passphrase__key">
              <span className="setup-passphrase__words">{exported.passphrase}</span>
              <Button onClick={() => void navigator.clipboard.writeText(exported.passphrase).then(() => setCopied(true), () => setExportError('Could not copy; select the words and copy them instead.'))}>{copied ? 'Copied' : 'Copy'}</Button>
            </div>
            <div className="setup-passphrase__note">
              Not saved anywhere. Lost it? Export again.{' '}
              <button type="button" className="setup-passphrase__link" onClick={() => void window.setup?.showFile()}>Show file</button>
            </div>
          </div>
        )}
        {EXPORT_PARTS.map((p) => (
          <OptionRow key={p.id} title={p.title} help={p.help}>
            <OnOff value={parts.has(p.id)} onChange={(on) => toggle(p.id, on)} disabled={p.id === 'logins' && !parts.has('sources')} />
          </OptionRow>
        ))}
        {exportError && <Hint tone="danger">{exportError}</Hint>}
        <div className="setup-preview__actions">
          <Button variant="primary" onClick={() => void exportSetup()} disabled={exporting || parts.size === 0 || imp.step === 'applying'}>{exporting ? 'Exporting…' : 'Export…'}</Button>
        </div>
        </>}
      </Section>

      <Section title="Receive" description="A setup from another computer."
        actions={<>
          <Button onClick={openReceive} disabled={imp.step === 'applying'}>Show my code</Button>
          <Button onClick={() => void pick()} disabled={imp.step === 'applying'}>Import file…</Button>
        </>}>
        {receiving && imp.step !== 'preview' && (
          <ReceiveSetupPanel
            onReceived={(token, preview) => { setReceiving(false); setImp({ step: 'preview', token, preview, received: true }); }}
            onClose={() => setReceiving(false)}
          />
        )}
        {imp.step === 'passphrase' && (
          <form onSubmit={(e) => { e.preventDefault(); void unlock(imp.token); }}>
            <OptionRow title="Passphrase" help="The five words from the export.">
              <TextField autoFocus aria-label="Passphrase" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder="word-word-word-word-word" />
            </OptionRow>
            {imp.error && <Hint tone="danger">{imp.error}</Hint>}
            <Button type="submit" variant="primary" disabled={unlocking}>{unlocking ? 'Opening…' : 'Open'}</Button>
          </form>
        )}
        {imp.step === 'preview' && imp.received && sources.length === 0 && (
          // A fresh install: nothing to replace, so no warning and no backup, just yes or no
          <div className="setup-preview">
            <div className="setup-preview__summary"><Hint>Ready to set up: {setupSummary(imp.preview)}.</Hint></div>
            <div className="setup-preview__actions">
              <Button variant="primary" onClick={() => void apply(imp.token, false)}>Set up sbtlTV</Button>
              <Button onClick={() => setImp({ step: 'idle' })}>Decline</Button>
            </div>
          </div>
        )}
        {imp.step === 'preview' && !(imp.received && sources.length === 0) && (
          <div className="setup-preview">
            <div className="setup-preview__summary">
              <Hint>
                From sbtlTV {imp.preview.app} on {platformName(imp.preview.platform)}{exportedOn(imp.preview.exportedAt)}: {setupSummary(imp.preview)}.
              </Hint>
              <Hint tone="warn">{imp.received ? receivedNote(imp.preview) : 'Replaces your sources, settings, API keys, favorites, watchlist and watch progress. Anything not in the file is cleared.'}</Hint>
            </div>
            <OptionRow title="Back up my setup first" help="Kept on this computer. Restore it here if needed."><OnOff value={backupFirst} onChange={setBackupFirst} /></OptionRow>
            <div className="setup-preview__actions">
              <Button variant="danger" onClick={() => void apply(imp.token)}>{imp.restoring ? 'Replace and restore' : imp.received ? 'Replace' : 'Replace and import'}</Button>
              <Button onClick={() => setImp({ step: 'idle' })}>{imp.received ? 'Decline' : 'Cancel'}</Button>
            </div>
          </div>
        )}
        {imp.step === 'applying' && <Hint>Working… sbtlTV restarts when done.</Hint>}
        {imp.step === 'failed' && (
          <>
            <Hint tone="danger">{imp.error}</Hint>
            {imp.backupName && (
              <>
                <Hint tone="warn">The import didn't finish. Restore your previous setup?</Hint>
                <Button variant="primary" onClick={() => void restoreNow(imp.backupName!)}>Restore</Button>
              </>
            )}
          </>
        )}
      </Section>

      {backups.length > 0 && (
        <Section title="Restore previous setup" description="Made before each import (with Back up first on). The last three stay on this computer.">
          {backups.map((b) => (
            <OptionRow key={b.name} title={b.label}>
              <Button onClick={() => void openBackup(b.name)} disabled={imp.step === 'applying'}>Restore…</Button>
            </OptionRow>
          ))}
        </Section>
      )}
    </SettingsTab>
  );
}
