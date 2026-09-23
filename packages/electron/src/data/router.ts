import type { DatabaseSync } from 'node:sqlite';
import { isDataRequest, type DataReply, type DataRequest, type VodDetailFields } from '@sbtltv/core';
import { runQuery } from './queries.js';

export type SyncJob =
  | { kind: 'channels'; sourceId: string }
  | { kind: 'vod'; sourceId: string }
  | { kind: 'episodes'; sourceId: string; seriesId: string }
  | { kind: 'rematch'; sourceId: string }
  | { kind: 'vodDetails'; itemKind: 'movie' | 'series'; itemId: string; fields: VodDetailFields }
  | { kind: 'importPlaylist'; sourceId: string; content: string }
  | { kind: 'deleteSource'; sourceId: string }
  | { kind: 'clearAll' };

// Two queued jobs that would do the same work (a scheduler pass and a Sync button,
// or two scheduler passes) collapse into one. Jobs carrying data never collapse.
export function isSameJob(a: SyncJob, b: SyncJob): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'channels': case 'vod': case 'rematch': case 'deleteSource': return a.sourceId === (b as { sourceId: string }).sourceId;
    case 'episodes': return a.seriesId === (b as { seriesId: string }).seriesId;
    case 'clearAll': return true;
    default: return false;
  }
}

const CONTROL = new Set(['syncNow', 'syncEpisodes', 'rematchEpg', 'updateVodDetails', 'importPlaylist', 'clearAll']);
const READS = new Set(['categories', 'channels', 'channelsByIds', 'channelCount', 'channelSearch', 'programsInRange', 'currentProgram', 'syncStatus', 'movies', 'series', 'episodes', 'vodCategories', 'vodCounts']);

// Answers one renderer message: reads run against the read connection, control
// requests are acknowledged and queued for the worker. Anything that is not a
// request envelope is ignored; an unknown type gets an error reply.
export function routeRendererMessage(db: DatabaseSync, msg: unknown, send: (reply: DataReply) => void, enqueue: (job: SyncJob) => void, sourceIdsForAll: () => string[] = () => []): void {
  if (!isDataRequest(msg)) return;
  const req = msg as DataRequest;
  try {
    if (CONTROL.has(req.type)) {
      if (req.type === 'syncNow') {
        const ids = req.sourceId ? [req.sourceId] : sourceIdsForAll();
        for (const sourceId of ids) {
          if (req.what !== 'vod') enqueue({ kind: 'channels', sourceId });
          if (req.what !== 'channels') enqueue({ kind: 'vod', sourceId });
        }
      } else if (req.type === 'syncEpisodes') {
        const row = db.prepare('select source_id from vod_series where series_id = ?').get(req.seriesId) as { source_id: string } | undefined;
        const sourceId = row?.source_id ?? req.seriesId.slice(0, req.seriesId.indexOf('_'));
        enqueue({ kind: 'episodes', sourceId, seriesId: req.seriesId });
      } else if (req.type === 'rematchEpg') {
        enqueue({ kind: 'rematch', sourceId: req.sourceId });
      } else if (req.type === 'updateVodDetails') {
        enqueue({ kind: 'vodDetails', itemKind: req.kind, itemId: req.itemId, fields: req.fields });
      } else if (req.type === 'importPlaylist') {
        enqueue({ kind: 'importPlaylist', sourceId: req.sourceId, content: req.content });
      } else {
        enqueue({ kind: 'clearAll' });
      }
      send({ id: req.id, ok: true, data: { accepted: true } });
      return;
    }
    if (!READS.has(req.type)) throw new Error(`unknown request type: ${String(req.type)}`);
    send({ id: req.id, ok: true, data: runQuery(db, req) });
  } catch (e) {
    send({ id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
