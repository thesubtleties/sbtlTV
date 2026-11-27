/**
 * A guide sync's programmes, staged on disk as they are parsed, so the whole guide is never held in memory. Each sync
 * gets its own scratch database file next to the data file, attached under a unique name: nothing depends on SQLite's
 * temp storage (which some builds keep in RAM, Android's among them), two syncs never share a table even on one
 * connection, and deleting the file gives the disk back. commitStagedEpg (writes.ts) swaps it in. A crash can leave a
 * file behind; the data process sweeps them before its workers start (sweepStagingFiles).
 */
import type { Db, Platform } from './platform.js';
import type { EpgProgramInput } from './writes.js';
import { rollbackQuietly } from './sql.js';

export const STAGING_BATCH = 5000;
const PREFIX = 'guide-staging-';

export interface GuideStaging {
  readonly sourceId: string;
  readonly epgSource: string;
  /** `<alias>.epg_staging`, for the commit's insert-select. */
  readonly table: string;
  add(p: EpgProgramInput): void;
  flush(): void;
  /** Programmes added, duplicates included (the count the guide sync reports). */
  readonly parsed: number;
  discard(): void;
}

// `dir` null: a private scratch database SQLite manages itself (only the test-facing replaceEpg uses it).
export function openStaging(db: Db, platform: Platform, dir: string | null, sourceId: string, epgSource: string): GuideStaging {
  const id = platform.uuid().replace(/-/g, '');
  const alias = `stage_${id.slice(0, 12)}`;
  const file = dir === null ? null : platform.files.join(dir, `${PREFIX}${id}.sqlite`);
  db.prepare(`attach database ? as ${alias}`).run(file ?? '');
  db.exec(`pragma ${alias}.journal_mode = off`);
  db.exec(`pragma ${alias}.synchronous = off`);
  // No primary key: duplicates are dropped by the commit's insert or ignore, which keeps the first one in staging
  // order (as the old one-transaction insert did). Faster batches, smaller file.
  db.exec(`create table ${alias}.epg_staging(id text not null, epg_channel_id text not null, start integer not null,
    end integer not null, title text not null, description text not null default '')`);
  const ins = db.prepare(`insert into ${alias}.epg_staging(id, epg_channel_id, start, end, title, description) values (?, ?, ?, ?, ?, ?)`);
  let buffer: EpgProgramInput[] = [];
  let parsed = 0;
  let open = true;
  const flush = () => {
    if (buffer.length === 0) return;
    // Plain begin: only the scratch file is written, so the data file's write lock is never taken here.
    db.exec('begin');
    try {
      for (const p of buffer) ins.run(`${sourceId}::${epgSource}::${p.epg_channel_id}::${p.startMs}`, p.epg_channel_id, p.startMs, p.endMs, p.title, p.description);
      db.exec('commit');
    } catch (e) {
      rollbackQuietly(db);
      throw e;
    }
    buffer = [];
  };
  return {
    sourceId, epgSource, table: `${alias}.epg_staging`,
    add(p) { parsed++; buffer.push(p); if (buffer.length >= STAGING_BATCH) flush(); },
    flush,
    get parsed() { return parsed; },
    discard() {
      buffer = [];
      if (!open) return;
      open = false;
      db.exec(`detach database ${alias}`);
      if (file) platform.files.remove(file);
    },
  };
}

// Removes scratch files a crash left in `dir`. Only safe while no guide sync runs (the data process calls it before
// starting its workers).
export function sweepStagingFiles(platform: Platform, dir: string): number {
  let n = 0;
  for (const f of platform.files.list(dir)) {
    if (f.startsWith(PREFIX)) { platform.files.remove(platform.files.join(dir, f)); n++; }
  }
  return n;
}
