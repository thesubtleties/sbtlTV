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
import { buildSetupBody, describeSetup, explainExportProblem, validateSetupBody, type SetupBody, type SetupPart, type SetupPreview, type UserLists } from './setup-body.js';
import { CACHE_RESET_MARKER, PENDING_PLAYLISTS, backupLabel, backupName, backupsToPrune } from './setup-backups.js';
import { receivedChanges } from './setup-send.js';

const MAX_FILE = 512 * 1024 * 1024;
const MESSAGES: Record<string, string> = {
  invalid: "This file isn't a valid sbtlTV setup",
  newer: 'This setup was made by a newer sbtlTV. Update sbtlTV first.',
  'wrong-passphrase': "That passphrase doesn't open this file.",
  'other-computer': 'This backup can only be restored on the computer, and with the keyring, it was made with.',
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

/** `sourceIds`: only these sources (Send a setup), so one that isn't picked can't stop the send. */
export function buildBody(parts: SetupPart[], lists: UserLists, playlists: Record<string, string>, sourceIds: string[] | null = null): SetupBody {
  const pending = Object.fromEntries(readPending().map((p) => [p.sourceId, p.content]));
  const stored = storage.readSetupForExport();
  if (sourceIds) stored.sources = stored.sources.filter((s) => sourceIds.includes(s.id));
  const body = buildSetupBody(parts, stored, lists, playlists,
    { app: app.getVersion(), exportedAt: new Date().toISOString(), platform: process.platform }, pending);
  try {
    return validateSetupBody(body);  // what we write must be what we would accept
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);  // field names only, never values
    throw new ExportProblem(explainExportProblem(detail, body.sources ?? []), detail);
  }
}

/** This computer's own setup breaks a rule a setup file must follow (message says which; detail = field names only, for the log). */
export class ExportProblem extends Error {
  constructor(message: string, readonly detail: string) { super(message); }
}

const backupsDir = () => path.join(app.getPath('userData'), 'backups');

function readPending(): { sourceId: string; content: string }[] {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), PENDING_PLAYLISTS), 'utf8')) as unknown;
    return Array.isArray(list) ? list.filter((p) => typeof p?.sourceId === 'string' && typeof p?.content === 'string') : [];
  } catch {
    return [];
  }
}

export function registerSetupTransfer(deps: { window: () => BrowserWindow | null; relaunch: () => void; log: (m: string) => void }): { stage(body: SetupBody): { token: string; preview: SetupPreview } } {
  const picked = new Map<string, { file: Buffer; body?: SetupBody; received?: boolean }>();
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
      // The reason only: Node's file errors carry paths (the user's home folder).
      deps.log(`Setup export failed: ${error instanceof storage.SecretsUnreadable ? 'secrets unreadable' : error instanceof ExportProblem ? error.detail : (error as NodeJS.ErrnoException)?.code ?? (error instanceof Error ? error.name : 'unknown')}`);
      return { error: message(error) };
    }
  });

  ipcMain.handle('setup:pick', async () => {
    try {
      const win = deps.window();
      if (!win) return { success: false, canceled: true };
      const choice = await dialog.showOpenDialog(win, { title: 'Import setup', filters: [{ name: 'sbtlTV setup', extensions: ['sbtltv'] }, { name: 'All files', extensions: ['*'] }], properties: ['openFile'] });
      if (choice.canceled || !choice.filePaths[0]) return { success: false, canceled: true };
      if (fs.statSync(choice.filePaths[0]).size > MAX_FILE) throw new SetupFileError('invalid');
      const file = fs.readFileSync(choice.filePaths[0]);
      const header = readHeader(file);
      const token = randomUUID();
      picked.clear();
      picked.set(token, { file });
      // A backup opens only from Restore previous setup (its own folder): a keyring-sealed
      // file from elsewhere could open with no passphrase where the keyring is weak.
      if (header.kdf.name === 'keyring') return { error: 'This is a backup, not a setup file. Restore it from Restore previous setup below.' };
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
      return { error: `Your current setup couldn't be backed up, so nothing changed. ${message(error)}` };
    }
    try {
      const userData = app.getPath('userData');
      const changes = entry.received ? receivedChanges(body) : null;
      if (changes) {
        // Sent with Send a setup: only what it carries changes (lists, and anything not sent, stay)
        storage.applyReceivedSetup({
          ...(changes.sources && { sources: body.sources }),
          ...(changes.settings && { settings: body.settings }),
          apiKeys: body.apiKeys ?? {},
        });
      } else {
        storage.replaceSetup({ sources: body.sources ?? [], settings: body.settings ?? {}, apiKeys: body.apiKeys ?? {} });
      }
      if (!changes || changes.sources) {
        const pending = (body.sources ?? []).flatMap((s) => (s.playlist ? [{ sourceId: s.id, content: s.playlist }] : []));
        fs.writeFileSync(path.join(userData, PENDING_PLAYLISTS), JSON.stringify(pending));
        fs.writeFileSync(path.join(userData, CACHE_RESET_MARKER), '');
      }
      picked.delete(token);
      deps.log(`Setup ${changes ? 'received' : 'imported'} (${body.includes.join(', ')}), backup ${written ? 'written' : 'skipped'}`);
      // null lists = leave this computer's favorites, watchlist and progress alone
      return { success: true, data: { lists: changes ? null : body.lists ?? {}, backupName: written } };
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
  // Not while the old cache is still due to go: channels found there would settle a
  // playlist that the next start's reset then deletes.
  ipcMain.handle('setup:pendingPlaylists', () =>
    fs.existsSync(path.join(app.getPath('userData'), CACHE_RESET_MARKER)) ? [] : readPending());

  ipcMain.handle('setup:settlePlaylists', (_e, sourceIds: unknown) => {
    if (!Array.isArray(sourceIds)) return;
    const left = readPending().filter((p) => !sourceIds.includes(p.sourceId));
    const file = path.join(app.getPath('userData'), PENDING_PLAYLISTS);
    if (left.length) fs.writeFileSync(file, JSON.stringify(left));
    else fs.rmSync(file, { force: true });
  });

  const received = new Set<string>();
  return {
    // A setup received through the mailbox: staged like an opened file, applied by setup:apply.
    // Replaces an earlier received one only, so a file import waiting for its passphrase stays.
    stage(body: SetupBody) {
      const token = randomUUID();
      for (const old of received) picked.delete(old);
      received.clear();
      received.add(token);
      picked.set(token, { file: Buffer.alloc(0), body, received: true });
      return { token, preview: describeSetup(body) };
    },
  };
}
