import { DatabaseSync } from 'node:sqlite';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { NewerSchemaError, migrate, reindexGuide } from './schema.js';

export interface OpenOptions {
  readOnly: boolean;
  log?: (message: string) => void;
  // Told when the file couldn't be used and the data starts over from the sources.
  onReset?: (reason: string) => void;
  // false: never replace the file, fail instead. Only one role may, or it could replace
  // the file under another that has it open.
  recover?: boolean;
  // How long a statement waits for a lock held by another connection. Writers
  // on the two sync lanes wait for each other's transactions (a guide replace on a
  // very large guide commits in tens of seconds); readers under WAL rarely wait at all.
  busyTimeoutMs?: number;
}

function tryOpen(path: string, opts: OpenOptions): DatabaseSync {
  const db = new DatabaseSync(path, { readOnly: opts.readOnly, timeout: opts.busyTimeoutMs ?? 5000 });
  try {
    if (!opts.readOnly) {
      db.exec('pragma journal_mode = wal');
      // NORMAL under WAL: a power cut can lose the last transaction but never
      // corrupts the file. Everything in it is rebuildable, so that trade is fine.
      db.exec('pragma synchronous = normal');
    }
    db.exec('pragma foreign_keys = on');
  } catch (e) {
    // A file that is not a database fails here, after the handle exists. Close it
    // before giving up: Windows will not rename a file that is still open.
    try { db.close(); } catch { /* already unusable */ }
    throw e;
  }
  return db;
}

// quick_check rather than the spec's integrity_check: it runs on every launch
// against a file that can reach hundreds of MB, and skips only the exhaustive
// index cross-checks. Everything in the file is rebuildable anyway.
function healthy(db: DatabaseSync): boolean {
  try {
    const row = db.prepare('pragma quick_check').get() as { quick_check: string };
    return row.quick_check === 'ok';
  } catch {
    return false;
  }
}

// Opens the file and returns null (closing it) when it fails the quick check.
function openHealthy(path: string, opts: OpenOptions): DatabaseSync | null {
  let db: DatabaseSync | null = null;
  try {
    db = tryOpen(path, opts);
    if (healthy(db)) return db;
    // Only the search index damaged: it is built from the programmes beside it
    reindexGuide(db);
    if (healthy(db)) return db;
  } catch {
    // fall through: unopenable counts as unhealthy
  }
  try { db?.close(); } catch { /* already unusable */ }
  return null;
}

// Opens (creating if needed) the data file. The writer connection runs the
// integrity check and migrations; readers assume the writer already did.
// The file holds provider logins in its stream links, so a copy is never kept. Earlier
// versions kept .corrupt- copies: those go too.
function removeFile(path: string): void {
  for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
}

function removeOldCopies(path: string): void {
  const name = basename(path);
  try {
    for (const f of readdirSync(dirname(path))) {
      if (f.startsWith(`${name}.corrupt-`) || f.startsWith(`${name}.aside-`)) rmSync(join(dirname(path), f), { force: true });
    }
  } catch { /* the next open tries again */ }
}

export function openDatabase(path: string, opts: OpenOptions): DatabaseSync {
  const log = opts.log ?? (() => {});
  if (opts.readOnly) return tryOpen(path, opts);
  const recover = opts.recover ?? true;
  if (recover) removeOldCopies(path);

  let db = openHealthy(path, opts);
  if (!db) {
    if (!recover) throw new Error('data file failed its integrity check');
    if (existsSync(path)) {
      removeFile(path);
      log('data file failed its integrity check; removed it and starting fresh');
      opts.onReset?.('integrity check failed');
    }
    db = tryOpen(path, opts);
  }
  try {
    migrate(db);
  } catch (e) {
    // Only a file from a newer build is given up. Anything else (a full disk) may pass, and
    // imported playlists exist only in this file: the error stands and the file stays.
    if (!recover || !(e instanceof NewerSchemaError)) {
      try { db.close(); } catch { /* already unusable */ }
      throw e;
    }
    db.close();
    removeFile(path);
    log(`data file is from a newer version (${e.message}); removed it and starting fresh`);
    opts.onReset?.(e.message);
    db = tryOpen(path, opts);
    migrate(db);
  }
  return db;
}
