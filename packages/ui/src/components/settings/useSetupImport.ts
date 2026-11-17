import { useEffect, useState } from 'react';
import type { SetupPreview } from '../../types/electron';
import { useUIStore } from '../../stores/uiStore';
import { readLists, replaceLists, type ListPart } from '../../services/setup/lists';
import { rebuildFilePlaylists } from '../../services/setup/filePlaylists';

const LIST_PARTS: ListPart[] = ['favorites', 'watchlist', 'progress'];

export type ImportState =
  | { step: 'idle' }
  | { step: 'passphrase'; token: string; error?: string }
  | { step: 'preview'; token: string; preview: SetupPreview; restoring?: boolean; received?: boolean }
  | { step: 'join'; computers: string[] }
  | { step: 'applying' }
  | { step: 'failed'; error: string; backupName: string | null };

/**
 * Receiving a setup (code, file or backup) or a sync join: the steps from passphrase to preview to
 * apply, shared by Settings › Sync & transfer and the first-run setup. onJoined runs after a join.
 */
export function useSetupImport(onJoined?: () => void) {
  const sources = useUIStore((s) => s.sources);
  const [imp, setImp] = useState<ImportState>({ step: 'idle' });
  const [passphrase, setPassphrase] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [backupFirst, setBackupFirst] = useState(true);
  const [joinName, setJoinName] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [defaultName, setDefaultName] = useState('');
  const [syncing, setSyncing] = useState(false);
  useEffect(() => { void window.sync?.view().then((v) => { setDefaultName(v.defaultName); setSyncing(v.status === 'active'); }); }, [imp.step]);
  const join = async () => {
    setJoining(true); setJoinError(null);
    const r = await window.mailbox?.join(joinName);
    setJoining(false);
    if (r?.error) setJoinError(r.error); else { setImp({ step: 'idle' }); setJoinName(''); onJoined?.(); }
  };
  const declineJoin = () => { void window.mailbox?.cancel(); setImp({ step: 'idle' }); setJoinName(''); setJoinError(null); };

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

  async function apply(token: string, withBackup = backupFirst, before?: () => Promise<void>) {
    setImp({ step: 'applying' });
    let backupName: string | null = null;
    try {
      if (before) await before();
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

  return {
    imp, setImp, passphrase, setPassphrase, unlocking, backupFirst, setBackupFirst,
    pick, unlock, apply, restoreNow, openBackup,
    joinName, setJoinName, joining, joinError, join, declineJoin, defaultName, syncing,
  };
}

export type SetupImport = ReturnType<typeof useSetupImport>;
