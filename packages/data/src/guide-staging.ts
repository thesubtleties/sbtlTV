/**
 * A guide sync's programmes, staged on disk as they are parsed, so the whole guide is never held in memory. A TEMP
 * table: it belongs to this connection only (an M3U import's guide sync on the quick lane can overlap the sync lane's),
 * and a crash leaves nothing behind. commitStagedEpg (writes.ts) swaps it in.
 */
import type { Db } from './platform.js';
import type { EpgProgramInput } from './writes.js';

export const STAGING_BATCH = 5000;

export interface GuideStaging {
  add(p: EpgProgramInput): void;
  flush(): void;
  readonly parsed: number;
  discard(): void;
}

export function openStaging(db: Db, sourceId: string, epgSource: string): GuideStaging {
  // The worker keeps its connection between jobs: a table left by an earlier sync goes first.
  db.exec('drop table if exists temp.epg_staging');
  db.exec(`create temp table epg_staging(id text primary key, epg_channel_id text not null, start integer not null,
    end integer not null, title text not null, description text not null default '')`);
  const ins = db.prepare('insert or ignore into temp.epg_staging(id, epg_channel_id, start, end, title, description) values (?, ?, ?, ?, ?, ?)');
  let buffer: EpgProgramInput[] = [];
  let parsed = 0;
  const flush = () => {
    if (buffer.length === 0) return;
    // Plain begin: only the temp table is written, so the main file's write lock is never taken here.
    db.exec('begin');
    try {
      for (const p of buffer) ins.run(`${sourceId}::${epgSource}::${p.epg_channel_id}::${p.startMs}`, p.epg_channel_id, p.startMs, p.endMs, p.title, p.description);
      db.exec('commit');
    } catch (e) {
      db.exec('rollback');
      throw e;
    }
    buffer = [];
  };
  return {
    add(p) { parsed++; buffer.push(p); if (buffer.length >= STAGING_BATCH) flush(); },
    flush,
    get parsed() { return parsed; },
    discard() { buffer = []; db.exec('drop table if exists temp.epg_staging'); },
  };
}
