import './BackupTransferTab.css';
import { useEffect, useState } from 'react';
import type { SetupPart } from '../../types/electron';
import { useUIStore } from '../../stores/uiStore';
import { readLists, type ListPart } from '../../services/setup/lists';
import { rebuildFilePlaylists } from '../../services/setup/filePlaylists';
import { Button, Hint, OnOff, OptionRow, Section, SettingsTab } from './ui';
import { SendSetupPanel } from './SendSetupPanel';
import { SyncSection } from './SyncSection';
import { ReceiveSection } from './ReceiveSection';
import { useSetupImport } from './useSetupImport';

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
/** The last export, kept by Settings while it is open (switching tabs keeps it; closing Settings clears it). */
export interface LastExport { passphrase: string; filePath: string }

export function BackupTransferTab({ lastExport, onExported, autoReceive, onAutoReceiveUsed, autoAdd, onAutoAddUsed }: { lastExport: LastExport | null; onExported: (e: LastExport) => void; autoReceive?: boolean; onAutoReceiveUsed?: () => void; autoAdd?: boolean; onAutoAddUsed?: () => void }) {
  const sources = useUIStore((s) => s.sources);
  const [parts, setParts] = useState(() => new Set(EXPORT_PARTS.filter((p) => p.defaultOn).map((p) => p.id)));
  const [exporting, setExporting] = useState(false);
  const exported = lastExport;
  const [exportError, setExportError] = useState<string | null>(null);
  const im = useSetupImport();
  const { imp } = im;
  const [copied, setCopied] = useState(false);
  const [backups, setBackups] = useState<{ name: string; label: string }[]>([]);
  // Transfer: one of export or send open at a time (an export just made stays open). Receive: the code panel.
  const [transfer, setTransfer] = useState<'none' | 'export' | 'send'>(lastExport ? 'export' : 'none');
  const [receiving, setReceiving] = useState(!!autoReceive);
  // "Receive a setup" opens the code once; coming back to this tab later doesn't start another
  useEffect(() => { if (autoReceive) onAutoReceiveUsed?.(); }, [autoReceive, onAutoReceiveUsed]);
  const [adding, setAdding] = useState(!!autoAdd && !autoReceive);
  // "Add a computer…" from What's new opens the panel once
  useEffect(() => { if (autoAdd) onAutoAddUsed?.(); }, [autoAdd, onAutoAddUsed]);
  // One knock at a time: opening Send, Receive or Add a computer closes the others
  const openSend = () => { setReceiving(false); setAdding(false); setTransfer(transfer === 'send' ? 'none' : 'send'); };
  const openReceive = () => { if (!receiving && transfer === 'send') setTransfer('none'); setAdding(false); setReceiving(!receiving); };
  const openAdding = (open: boolean) => { if (open) { setReceiving(false); if (transfer === 'send') setTransfer('none'); } setAdding(open); };

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
      <details className="setup-how-drawer">
        <summary className="setup-how-drawer__summary">How sending works</summary>
        <div className="setup-how-drawer__body">
          <div className="setup-how">
            <div>
              <div className="setup-how__title">To receive</div>
              <ol className="setup-how__steps">
                <li>Show my code, and tell it to the person sending.</li>
                <li>They type it in. You both see three words.</li>
                <li>Same words? Tap Same words. Nothing changes until you accept it.</li>
              </ol>
            </div>
            <div>
              <div className="setup-how__title">To send</div>
              <ol className="setup-how__steps">
                <li>Ask for their code. They find it under Live TV › Receive a setup, or here.</li>
                <li>Pick what to send, type the code, Connect.</li>
                <li>Check you both see the same three words, then send.</li>
              </ol>
            </div>
          </div>
          <Hint>Only use a code from someone you know. Different words mean someone else answered: stop there. Setups and Sync are both end-to-end encrypted on the sbtlTV relay: even we can't read them. A setup is deleted once it's picked up; Sync stays while you use it.</Hint>
        </div>
      </details>

      <SyncSection adding={adding} onAdding={openAdding} />

      <Section title="Transfer setup" description="To another computer, or someone else's."
        actions={<>
          <Button onClick={openSend} aria-expanded={transfer === 'send'} disabled={imp.step === 'applying'}>Send to a device…</Button>
          <Button onClick={() => setTransfer(transfer === 'export' ? 'none' : 'export')} aria-expanded={transfer === 'export'} disabled={imp.step === 'applying'}>Export to file…</Button>
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

      <ReceiveSection im={im} receiving={receiving} onReceiving={(open) => { if (open !== receiving) openReceive(); }} />


      {backups.length > 0 && (
        <Section title="Restore previous setup" description="Made before each import (with Back up first on). The last three stay on this computer.">
          {backups.map((b) => (
            <OptionRow key={b.name} title={b.label}>
              <Button onClick={() => void im.openBackup(b.name)} disabled={imp.step === 'applying'}>Restore…</Button>
            </OptionRow>
          ))}
        </Section>
      )}
    </SettingsTab>
  );
}
