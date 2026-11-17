import type { ReactNode } from 'react';
import { useUIStore } from '../../stores/uiStore';
import { setupSummary } from '../../services/setup/summary';
import { receivedNote } from '../../utils/receivedNote';
import { nameIfBlank } from '../../utils/computerName';
import { Button, Hint, OnOff, OptionRow, Section, TextField } from './ui';
import { ReceiveSetupPanel } from './ReceiveSetupPanel';
import type { SetupImport } from './useSetupImport';

const PLATFORMS: Record<string, string> = { linux: 'Linux', darwin: 'macOS', win32: 'Windows' };
const platformName = (p: string) => PLATFORMS[p] ?? p;
function exportedOn(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `, ${d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
}

/** "Mac", "Mac and Linux PC", "Mac, Linux PC and Windows PC" */
const names = (list: string[]) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0] ?? '');

/**
 * Receive a setup or a sync join: Show my code, Import file…, then the passphrase, preview, join and
 * apply steps. onApplying runs before a setup is applied (and the app restarts).
 */
export function ReceiveSection({ im, receiving, onReceiving, title = 'Receive', description = 'A setup, or to join your sync.', onApplying, actions, onPanelClose }: {
  im: SetupImport;
  receiving: boolean;
  onReceiving: (open: boolean) => void;
  title?: string;
  description?: ReactNode;
  onApplying?: () => Promise<void>;
  /** Replaces the Show my code / Import file… buttons */
  actions?: ReactNode;
  /** The person closed the code panel (not: a setup or join arrived) */
  onPanelClose?: () => void;
}) {
  const sources = useUIStore((s) => s.sources);
  const { imp, setImp, passphrase, setPassphrase, unlocking, backupFirst, setBackupFirst, pick, unlock, restoreNow, joinName, setJoinName, joining, joinError, join, declineJoin, defaultName, syncing } = im;
  const apply = (token: string, withBackup?: boolean) => im.apply(token, withBackup ?? backupFirst, onApplying);
  return (
      <Section title={title} description={description}
        actions={actions ?? <>
          <Button onClick={() => onReceiving(!receiving)} aria-expanded={receiving} disabled={imp.step === 'applying'}>Show my code</Button>
          <Button onClick={() => void pick()} disabled={imp.step === 'applying'}>Import file…</Button>
        </>}>
        {receiving && imp.step !== 'preview' && (
          <ReceiveSetupPanel
            onReceived={(token, preview) => { onReceiving(false); setImp({ step: 'preview', token, preview, received: true }); }}
            onJoin={(computers) => { onReceiving(false); setImp({ step: 'join', computers }); }}
            onClose={() => { onReceiving(false); onPanelClose?.(); }}
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
        {imp.step === 'join' && (
          <div className="setup-preview">
            <div className="setup-preview__summary">
              <Hint>Join sync with {names(imp.computers)}? Your watchlist and progress will be shared with them.</Hint>
              {syncing && <Hint tone="warn">This computer leaves its current sync.</Hint>}
            </div>
            <OptionRow title="Name this computer" help={`Leave blank for “${nameIfBlank(defaultName, imp.computers)}”.`}>
              <form onSubmit={(e) => { e.preventDefault(); if (!joining) void join(); }}>
                <TextField autoFocus aria-label="Name this computer" placeholder={nameIfBlank(defaultName, imp.computers)} maxLength={40} value={joinName} onChange={(e) => setJoinName(e.target.value)} />
              </form>
            </OptionRow>
            {joinError && <Hint tone="danger">{joinError}</Hint>}
            <div className="setup-preview__actions">
              <Button variant="primary" disabled={joining} onClick={() => void join()}>{joining ? 'Joining…' : 'Join'}</Button>
              <Button onClick={declineJoin}>Decline</Button>
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
  );
}
