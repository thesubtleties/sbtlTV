import type { DatabaseSync } from 'node:sqlite';
import { isDataRequest, type DataReply, type DataRequest } from '@sbtltv/core';
import { runQuery } from './queries.js';

export type SyncJob =
  | { kind: 'channels'; sourceId: string }
  | { kind: 'vod'; sourceId: string }
  | { kind: 'episodes'; sourceId: string; seriesId: string }
  | { kind: 'rematch'; sourceId: string }
  | { kind: 'deleteSource'; sourceId: string }
  | { kind: 'clearAll' };

const CONTROL = new Set(['syncNow', 'syncEpisodes', 'rematchEpg', 'clearAll']);
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
        const sourceId = req.seriesId.slice(0, req.seriesId.indexOf('_'));
        enqueue({ kind: 'episodes', sourceId, seriesId: req.seriesId });
      } else if (req.type === 'rematchEpg') {
        enqueue({ kind: 'rematch', sourceId: req.sourceId });
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
