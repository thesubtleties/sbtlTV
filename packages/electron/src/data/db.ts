import { DatabaseSync } from 'node:sqlite';
import { existsSync, renameSync } from 'node:fs';
import { migrate } from './schema.js';

export interface OpenOptions {
  readOnly: boolean;
  log?: (message: string) => void;
}

function tryOpen(path: string, opts: OpenOptions): DatabaseSync {
  const db = new DatabaseSync(path, { readOnly: opts.readOnly, timeout: 5000 });
  if (!opts.readOnly) {
    db.exec('pragma journal_mode = wal');
    db.exec('pragma synchronous = normal');
  }
  db.exec('pragma foreign_keys = on');
  return db;
}

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
  } catch {
    // fall through: unopenable counts as unhealthy
  }
  try { db?.close(); } catch { /* already unusable */ }
  return null;
}

// Opens (creating if needed) the data file. The writer connection runs the
// integrity check and migrations; readers assume the writer already did.
export function openDatabase(path: string, opts: OpenOptions): DatabaseSync {
  const log = opts.log ?? (() => {});
  if (opts.readOnly) return tryOpen(path, opts);

  let db = openHealthy(path, opts);
  if (!db) {
    if (existsSync(path)) {
      const aside = `${path}.corrupt-${Date.now()}`;
      renameSync(path, aside);
      for (const suffix of ['-wal', '-shm']) {
        if (existsSync(path + suffix)) renameSync(path + suffix, aside + suffix);
      }
      log(`data file failed its integrity check; moved to ${aside} and starting fresh (all of it is rebuildable)`);
    }
    db = tryOpen(path, opts);
  }
  migrate(db);
  return db;
}
