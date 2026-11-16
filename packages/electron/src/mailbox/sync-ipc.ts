// packages/electron/src/mailbox/sync-ipc.ts
/**
 * Sync in the main process: the engine (packages/mailbox) with the OS keyring as its sealer and the
 * relay transport. The renderer reports its records and applies the winners it's sent.
 */
import { app, ipcMain, safeStorage, type WebContents } from 'electron';
import path from 'node:path';
import { SYNCED_SETTING_KEYS, validateRecord, type SyncRecord, type SyncedSettingKey } from '@sbtltv/core';
import { SyncEngine, SyncStore, type Sealer } from '@sbtltv/mailbox/client';
import { relayTransport } from './relay-transport.js';

const sealer: Sealer = {
  // Linux "basic_text" is not a keyring: sync then refuses, like export does
  available: () => safeStorage.isEncryptionAvailable() && !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'),
  seal: (s) => safeStorage.encryptString(s).toString('base64'),
  open: (s) => safeStorage.decryptString(Buffer.from(s, 'base64')),
};

const platformName = () => (process.platform === 'darwin' ? 'Mac' : process.platform === 'win32' ? 'Windows PC' : 'Linux PC');
const HEX32 = /^[0-9a-f]{32}$/;

export function registerSync(deps: {
  renderer: () => WebContents | null;
  log: (m: string) => void;
  applySettings: (values: Partial<Record<SyncedSettingKey, unknown>>) => void | Promise<void>;
  /** This computer's synced settings now (for turning Settings on) */
  currentSettings: () => Partial<Record<SyncedSettingKey, unknown>>;
}) {
  const send = (channel: string, data?: unknown) => { const w = deps.renderer(); if (w && !w.isDestroyed()) w.send(channel, data); };
  const engine = new SyncEngine({
    store: new SyncStore(path.join(app.getPath('userData'), 'sync-state.json'), sealer),
    transport: (auth) => relayTransport({ auth }),
    defaultName: platformName(),
    log: deps.log,
    onApply: (records) => send('sync-apply', records),
    onSettings: (values) => {
      // Another computer's values, checked by type before they're stored (appearance and subtitles
      // are normalised by updateSettings itself)
      const ok: Partial<Record<SyncedSettingKey, unknown>> = {};
      if (values.theme === 'dark' || values.theme === 'light') ok.theme = values.theme;
      if (typeof values.autoplayNextEpisode === 'boolean') ok.autoplayNextEpisode = values.autoplayNextEpisode;
      for (const k of ['appearance', 'subtitles'] as const) {
        const v = values[k];
        if (v && typeof v === 'object' && !Array.isArray(v)) ok[k] = v;
      }
      if (Object.keys(ok).length === 0) return;
      // The page reloads its settings only once they're stored
      void Promise.resolve(deps.applySettings(ok)).then(() => send('settings-replaced'), () => deps.log('Sync: applying settings failed'));
    },
    onSnapshotNeeded: () => send('sync-snapshot'),
    currentSettings: deps.currentSettings,
    onChange: (v) => send('sync-view', v),
  });

  ipcMain.handle('sync:view', () => engine.view());
  // The page is listening: start (or, after a reload, pull again). Records handed over before
  // this would be marked applied but never reach the page.
  ipcMain.handle('sync:ready', () => { engine.start(); });
  ipcMain.handle('sync:record', (_e, records: unknown) => {
    if (!Array.isArray(records) || records.length > 50_000) return;
    engine.record(records.map(validateRecord).filter((r): r is SyncRecord => r !== null && r.k !== 'set'));
  });
  ipcMain.handle('sync:pull', () => { engine.nudge(); });
  ipcMain.handle('sync:dismissInterrupted', () => { engine.dismissInterrupted(); });
  // The page wrote these into its lists (only then are they "applied": a closed window or a failed
  // write gets them again on the next pull)
  ipcMain.handle('sync:applied', (_e, records: unknown) => {
    if (!Array.isArray(records) || records.length > 50_000) return;
    engine.confirm(records.map(validateRecord).filter((r): r is SyncRecord => r !== null));
  });
  ipcMain.handle('sync:setParts', (_e, p: unknown) => {
    const o = p as Record<string, unknown> | null;
    if (!o || typeof o.watchlist !== 'boolean' || typeof o.progress !== 'boolean' || typeof o.settings !== 'boolean') return;
    engine.setParts({ watchlist: o.watchlist, progress: o.progress, settings: o.settings });
  });
  ipcMain.handle('sync:rename', (_e, name: unknown) => { if (typeof name === 'string') engine.rename(name); });
  ipcMain.handle('sync:remove', async (_e, id: unknown) => {
    if (typeof id !== 'string' || !HEX32.test(id)) return { error: 'Not found.' };
    try { await engine.remove(id); return {}; } catch { deps.log('Sync: remove failed'); return { error: "Couldn't reach the sbtlTV relay. Try again." }; }
  });
  ipcMain.handle('sync:leave', async () => {
    try { await engine.leave(); return {}; } catch { deps.log('Sync: leave failed'); return { error: "Couldn't reach the sbtlTV relay. Try again." }; }
  });

  return {
    engine,
    /** A synced setting changed through Settings: becomes this computer's record. */
    settingsChanged(changed: Record<string, unknown>) {
      const values = Object.fromEntries(SYNCED_SETTING_KEYS.filter((k) => k in changed).map((k) => [k, changed[k]]));
      if (Object.keys(values).length) engine.settingsChanged(values);
    },
  };
}
