/**
 * Settings > Backup & transfer. The decrypted file stays here (keyed by a token)
 * between choosing it and applying it: logins and keys never go to the page.
 */
import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as storage from './storage.js';
import { newPassphrase, normalisePassphrase } from './setup-passphrase.js';
import { SetupFileError, openWithKeyring, openWithPassphrase, readHeader, sealWithKeyring, sealWithPassphrase } from './setup-file.js';
import { describeSetup, explainExportProblem, settingsForExport, validateSetupBody, type SetupBody, type SetupPart, type UserLists } from './setup-body.js';
import { CACHE_RESET_MARKER, PENDING_PLAYLISTS, backupLabel, backupName, backupsToPrune } from './setup-backups.js';

const MAX_FILE = 512 * 1024 * 1024;
const MESSAGES: Record<string, string> = {
  invalid: "This file isn't a valid sbtlTV setup",
  newer: 'This setup was made by a newer sbtlTV. Update sbtlTV first.',
  'wrong-passphrase': "That passphrase doesn't open this file.",
  'other-computer': 'This backup can only be restored on the computer that made it',
  'needs-passphrase': "This file isn't a valid sbtlTV setup",
  'needs-keyring': "This file isn't a valid sbtlTV setup",
};
const UNREADABLE = "Saved passwords can't be read right now, so the export would be missing them. Restart sbtlTV and try again.";

function message(error: unknown): string {
  if (error instanceof SetupFileError) return MESSAGES[error.reason];
  if (error instanceof storage.SecretsUnreadable) return UNREADABLE;
  if (error instanceof ExportProblem) return error.message;
  if (error instanceof Error && error.message.startsWith('invalid')) return MESSAGES.invalid;
  return error instanceof Error ? error.message : String(error);
}

function buildBody(parts: SetupPart[], lists: UserLists, playlists: Record<string, string>): SetupBody {
  const { sources, settings } = storage.readSetupForExport();
  const body: SetupBody = { app: app.getVersion(), exportedAt: new Date().toISOString(), platform: process.platform, includes: parts };
  if (parts.includes('sources')) {
    body.sources = sources.map((s) => ({
      id: s.id, name: s.name, type: s.type, url: s.url, enabled: s.enabled,
      ...(s.epg_url !== undefined && { epg_url: s.epg_url }),
      ...(s.auto_load_epg !== undefined && { auto_load_epg: s.auto_load_epg }),
      ...(s.username !== undefined && { username: s.username }),
      ...(parts.includes('logins') && s.password && { password: s.password }),
      ...(playlists[s.id] !== undefined && { playlist: playlists[s.id] }),
    }));
  }
  if (parts.includes('settings')) body.settings = settingsForExport(settings);
  if (parts.includes('apiKeys')) body.apiKeys = { ...(settings.tmdbApiKey && { tmdb: settings.tmdbApiKey }), ...(settings.posterDbApiKey && { posterDb: settings.posterDbApiKey }) };
  const l: UserLists = {};
  if (parts.includes('favorites') && lists.favorites) l.favorites = lists.favorites;
  if (parts.includes('watchlist') && lists.watchlist) l.watchlist = lists.watchlist;
  if (parts.includes('progress') && lists.progress) l.progress = lists.progress;
  if (parts.includes('settings') && lists.lastCategory) l.lastCategory = lists.lastCategory;
  if (Object.keys(l).length) body.lists = l;
  try {
    return validateSetupBody(body);  // what we write must be what we would accept
  } catch (error) {
    throw new ExportProblem(explainExportProblem(error instanceof Error ? error.message : String(error), body.sources ?? []));
  }
}

/** This computer's own setup breaks a rule a setup file must follow (message says which). */
class ExportProblem extends Error {}

const backupsDir = () => path.join(app.getPath('userData'), 'backups');

function readPending(): { sourceId: string; content: string }[] {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), PENDING_PLAYLISTS), 'utf8')) as unknown;
    return Array.isArray(list) ? list.filter((p) => typeof p?.sourceId === 'string' && typeof p?.content === 'string') : [];
  } catch {
    return [];
  }
}

export function registerSetupTransfer(deps: { window: () => BrowserWindow | null; relaunch: () => void; log: (m: string) => void }): void {
  const picked = new Map<string, { file: Buffer; body?: SetupBody }>();
  let lastExport: string | null = null;

  ipcMain.handle('setup:export', async (_e, req: { parts: SetupPart[]; lists: UserLists; playlists: Record<string, string> }) => {
    try {
      const body = buildBody(req.parts, req.lists ?? {}, req.playlists ?? {});
      const win = deps.window();
      const today = new Date().toISOString().slice(0, 10);
      const choice = win
        ? await dialog.showSaveDialog(win, { title: 'Export setup', defaultPath: path.join(app.getPath('documents'), `sbtltv-setup-${today}.sbtltv`), filters: [{ name: 'sbtlTV setup', extensions: ['sbtltv'] }] })
        : { canceled: true, filePath: undefined };
      if (choice.canceled || !choice.filePath) return { success: false, canceled: true };
      const passphrase = newPassphrase();
      fs.writeFileSync(choice.filePath, await sealWithPassphrase(body, passphrase));
      lastExport = choice.filePath;
      deps.log(`Setup exported (${req.parts.join(', ')})`);
      return { success: true, data: { passphrase, filePath: choice.filePath } };
    } catch (error) {
      deps.log(`Setup export failed: ${error instanceof storage.SecretsUnreadable ? 'secrets unreadable' : message(error)}`);
      return { error: message(error) };
    }
  });

  ipcMain.handle('setup:pick', async () => {
    try {
      const win = deps.window();
      if (!win) return { success: false, canceled: true };
      const choice = await dialog.showOpenDialog(win, { title: 'Import setup', filters: [{ name: 'sbtlTV setup', extensions: ['sbtltv'] }], properties: ['openFile'] });
      if (choice.canceled || !choice.filePaths[0]) return { success: false, canceled: true };
      if (fs.statSync(choice.filePaths[0]).size > MAX_FILE) throw new SetupFileError('invalid');
      const file = fs.readFileSync(choice.filePaths[0]);
      const header = readHeader(file);
      const token = randomUUID();
      picked.clear();
      picked.set(token, { file });
      if (header.kdf.name === 'keyring') {
        picked.get(token)!.body = validateSetupBody(openWithKeyring(file, storage.keyringProtector));
        return { success: true, data: { token, needsPassphrase: false } };
      }
      return { success: true, data: { token, needsPassphrase: true } };
    } catch (error) {
      return { error: message(error) };
    }
  });

  ipcMain.handle('setup:unlock', async (_e, token: string, passphrase: string) => {
    const entry = picked.get(token);
    if (!entry) return { error: 'Choose the file again.' };
    try {
      entry.body ??= validateSetupBody(await openWithPassphrase(entry.file, normalisePassphrase(String(passphrase))));
      return { success: true, data: describeSetup(entry.body) };
    } catch (error) {
      return { error: message(error) };
    }
  });

  ipcMain.handle('setup:backups', () => {
    let names: string[] = [];
    try { names = fs.readdirSync(backupsDir()); } catch { /* none yet */ }
    const data = names.flatMap((name) => { const label = backupLabel(name); return label ? [{ name, label }] : []; }).sort((a, b) => b.name.localeCompare(a.name));
    return { success: true, data };
  });

  ipcMain.handle('setup:openBackup', (_e, name: string) => {
    try {
      if (!backupLabel(String(name))) throw new SetupFileError('invalid');  // a backup name, never a path
      const file = fs.readFileSync(path.join(backupsDir(), name));
      const body = validateSetupBody(openWithKeyring(file, storage.keyringProtector));
      const token = randomUUID();
      picked.clear();
      picked.set(token, { file, body });
      return { success: true, data: { token, preview: describeSetup(body) } };
    } catch (error) {
      return { error: message(error) };
    }
  });

  ipcMain.handle('setup:apply', async (_e, token: string, opts: { backupFirst: boolean; currentLists: UserLists; currentPlaylists: Record<string, string> }) => {
    const entry = picked.get(token);
    if (!entry?.body) return { error: 'Choose the file again.' };
    const body = entry.body;
    let written: string | null = null;
    try {
      if (opts.backupFirst) {
        const all: SetupPart[] = ['sources', 'logins', 'settings', 'apiKeys', 'favorites', 'watchlist', 'progress'];
        const current = buildBody(all, opts.currentLists ?? {}, opts.currentPlaylists ?? {});
        fs.mkdirSync(backupsDir(), { recursive: true });
        written = backupName(new Date());
        fs.writeFileSync(path.join(backupsDir(), written), sealWithKeyring(current, storage.keyringProtector));
        for (const old of backupsToPrune(fs.readdirSync(backupsDir()))) fs.rmSync(path.join(backupsDir(), old), { force: true });
      }
    } catch (error) {
      return { error: `Your current setup couldn't be backed up, so nothing was changed. ${message(error)}` };
    }
    try {
      storage.replaceSetup({ sources: body.sources ?? [], settings: body.settings ?? {}, apiKeys: body.apiKeys ?? {} });
      const pending = (body.sources ?? []).flatMap((s) => (s.playlist ? [{ sourceId: s.id, content: s.playlist }] : []));
      const userData = app.getPath('userData');
      fs.writeFileSync(path.join(userData, PENDING_PLAYLISTS), JSON.stringify(pending));
      fs.writeFileSync(path.join(userData, CACHE_RESET_MARKER), '');
      picked.delete(token);
      deps.log(`Setup imported (${body.includes.join(', ')}), backup ${written ? 'written' : 'skipped'}`);
      return { success: true, data: { lists: body.lists ?? {}, backupName: written } };
    } catch (error) {
      return { error: message(error), backupName: written };
    }
  });

  ipcMain.handle('setup:relaunch', () => {
    deps.relaunch();
  });

  ipcMain.handle('setup:showFile', () => {
    if (lastExport) shell.showItemInFolder(lastExport);
  });

  // Pending until the page reports the source has its channels (setup:settlePlaylists).
  ipcMain.handle('setup:pendingPlaylists', () => readPending());

  ipcMain.handle('setup:settlePlaylists', (_e, sourceIds: unknown) => {
    if (!Array.isArray(sourceIds)) return;
    const left = readPending().filter((p) => !sourceIds.includes(p.sourceId));
    const file = path.join(app.getPath('userData'), PENDING_PLAYLISTS);
    if (left.length) fs.writeFileSync(file, JSON.stringify(left));
    else fs.rmSync(file, { force: true });
  });

}
