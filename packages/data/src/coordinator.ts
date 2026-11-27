import type { DataSettings, Source, SyncProgress } from '@sbtltv/core';
import type { Db } from './platform.js';
import type { SyncJob } from './router.js';
import { runQuery } from './queries.js';
import { dueSyncs } from './scheduler.js';

export function stageOf(job: SyncJob): SyncProgress['stage'] | null {
  switch (job.kind) {
    case 'channels': case 'importPlaylist': return 'channels';
    case 'vod': return 'vod';
    case 'episodes': return 'episodes';
    case 'rematch': return 'epg';
    default: return null;
  }
}

// The worker died mid-job: the renderer is told the stage failed so its banner clears.
export function workerStoppedProgress(job: SyncJob): SyncProgress | null {
  const stage = stageOf(job);
  if (!stage || !('sourceId' in job)) return null;
  return { sourceId: job.sourceId, stage, state: 'failed', message: 'sync worker stopped unexpectedly; retrying', ...(job.kind === 'episodes' ? { seriesId: job.seriesId } : {}) };
}

export function dueJobs(db: Db, sources: Source[], settings: DataSettings, nowMs: number): { job: SyncJob; category: string; message: string }[] {
  const metas = runQuery(db, { id: 0, type: 'syncStatus' }) as Parameters<typeof dueSyncs>[0];
  const out: { job: SyncJob; category: string; message: string }[] = [];
  for (const d of dueSyncs(metas, sources, settings, nowMs)) {
    // By id, never by name (a name can say who the provider is); the log shows it as [source N].
    if (d.channels) out.push({ job: { kind: 'channels', sourceId: d.sourceId }, category: 'sync', message: `Source ${d.sourceId} is stale, syncing...` });
    if (d.vod) out.push({ job: { kind: 'vod', sourceId: d.sourceId }, category: 'vod', message: `Source ${d.sourceId} is stale, syncing VOD...` });
  }
  return out;
}

// Rows for sources that are no longer configured (a delete that arrived while the process was down). Skipped when no
// sources are handed over at all, so a transient empty list can never wipe the file.
export function deletedSourceIds(db: Db, sources: Source[]): string[] {
  if (sources.length === 0) return [];
  const stored = db.prepare(`
    select source_id from sources_meta union select source_id from channels
    union select source_id from vod_movies union select source_id from vod_series`).all() as { source_id: string }[];
  const configured = new Set(sources.map((s) => s.id));
  return stored.map((r) => r.source_id).filter((id) => !configured.has(id));
}
