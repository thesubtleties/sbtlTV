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

// Whether two jobs would do the same work (a scheduler pass and a Sync button,
// or two scheduler passes): the lanes collapse such a job against the queue and
// the job in flight. Jobs carrying data never collapse.
export function isSameJob(a: SyncJob, b: SyncJob): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'channels': case 'vod': case 'rematch': case 'deleteSource': return a.sourceId === (b as { sourceId: string }).sourceId;
    case 'episodes': return a.seriesId === (b as { seriesId: string }).seriesId;
    case 'clearAll': return true;
    default: return false;
  }
}

// Plain string sets, not derived from the DataRequest union: a new request
// variant must be added here (and to validateRequest) or it is refused at runtime.
const CONTROL = new Set(['syncNow', 'syncEpisodes', 'rematchEpg', 'updateVodDetails', 'importPlaylist', 'clearAll']);
const READS = new Set(['categories', 'channels', 'channelsByIds', 'channelCount', 'channelSearch', 'programsInRange', 'currentProgram', 'syncStatus', 'movies', 'series', 'episodes', 'vodCategories', 'vodCounts']);

// Answers one renderer message: reads run against the read connection, control
// requests are acknowledged and queued for the worker. Anything that is not a
// request envelope is ignored; an unknown type gets an error reply.
// Shape checks for what isDataRequest does not cover: fields typed as arrays
// must be arrays (a stray string would widen a filter to "all sources"), lists
// have a size cap so one request cannot pin the read thread, limits are clamped,
// and numbers are numbers. Throws a message the renderer can show.
const MAX_LIST = 100_000;
const MAX_LIMIT = 10_000;
const MAX_TEXT = 1_000;
function bad(what: string): never { throw new Error(`invalid request: ${what}`); }
function list(v: unknown, name: string, item: 'string' | 'number'): void {
  if (!Array.isArray(v)) bad(`${name} must be an array`);
  if (v.length > MAX_LIST) bad(`${name} has more than ${MAX_LIST} entries`);
  for (const x of v) if (typeof x !== item) bad(`${name} must contain ${item}s`);
}
function num(v: unknown, name: string): void { if (typeof v !== 'number' || !Number.isFinite(v)) bad(`${name} must be a number`); }
function text(v: unknown, name: string): void { if (typeof v !== 'string' || v.length > MAX_TEXT) bad(`${name} must be a string of at most ${MAX_TEXT} characters`); }
function selector(by: unknown, idField: 'streamIds' | 'seriesIds'): void {
  const b = by as { kind?: unknown; categoryIds?: unknown; tmdbIds?: unknown; text?: unknown } & Record<string, unknown>;
  if (!b || typeof b !== 'object') bad('by must be an object');
  switch (b.kind) {
    case 'categories': list(b.categoryIds, 'categoryIds', 'string'); break;
    case 'tmdbIds': list(b.tmdbIds, 'tmdbIds', 'number'); break;
    case 'ids': list(b[idField], idField, 'string'); break;
    case 'search': text(b.text, 'text'); break;
    case 'all': case 'popular': break;
    default: bad('unknown selector');
  }
}
export function validateRequest(req: DataRequest): DataRequest {
  const r = req as DataRequest & Record<string, unknown>;
  switch (r.type) {
    case 'categories': case 'channelCount': case 'vodCounts': list(r.sourceIds, 'sourceIds', 'string'); break;
    case 'channels': list(r.sourceIds, 'sourceIds', 'string'); if (r.categoryId !== null) text(r.categoryId, 'categoryId'); if (r.sort !== 'alphabetical' && r.sort !== 'number') bad('sort'); break;
    case 'channelsByIds': list(r.streamIds, 'streamIds', 'string'); break;
    case 'channelSearch': list(r.sourceIds, 'sourceIds', 'string'); text(r.query, 'query'); num(r.limit, 'limit'); if ((r.limit as number) < 1) bad('limit must be positive'); r.limit = Math.min(r.limit as number, MAX_LIMIT); break;
    case 'programsInRange': list(r.streamIds, 'streamIds', 'string'); num(r.windowStartMs, 'windowStartMs'); num(r.windowEndMs, 'windowEndMs'); break;
    case 'currentProgram': text(r.streamId, 'streamId'); num(r.nowMs, 'nowMs'); break;
    case 'syncStatus': case 'clearAll': break;
    case 'movies': case 'series':
      list(r.sourceIds, 'sourceIds', 'string'); selector(r.by, r.type === 'movies' ? 'streamIds' : 'seriesIds');
      if (r.limit !== undefined) { num(r.limit, 'limit'); if ((r.limit as number) < 1) bad('limit must be positive'); r.limit = Math.min(r.limit as number, MAX_LIMIT); }
      break;
    case 'episodes': list(r.seriesIds, 'seriesIds', 'string'); break;
    case 'vodCategories': list(r.sourceIds, 'sourceIds', 'string'); if (r.kind !== 'movie' && r.kind !== 'series') bad('kind'); break;
    case 'syncNow': if (r.sourceId !== undefined) text(r.sourceId, 'sourceId'); if (!['channels', 'vod', 'all'].includes(r.what as string)) bad('what'); break;
    case 'syncEpisodes': text(r.seriesId, 'seriesId'); break;
    case 'rematchEpg': text(r.sourceId, 'sourceId'); break;
    case 'updateVodDetails': if (r.kind !== 'movie' && r.kind !== 'series') bad('kind'); text(r.itemId, 'itemId'); if (!r.fields || typeof r.fields !== 'object') bad('fields'); break;
    case 'importPlaylist': text(r.sourceId, 'sourceId'); if (typeof r.content !== 'string' || r.content.length > 64 * 1024 * 1024) bad('content must be a string under 64MB'); break;
  }
  return req;
}

export function routeRendererMessage(db: DatabaseSync, msg: unknown, send: (reply: DataReply) => void, enqueue: (job: SyncJob) => void, sourceIdsForAll: () => string[] = () => []): void {
  if (!isDataRequest(msg)) return;
  let req = msg as DataRequest;
  try {
    if (!READS.has(req.type) && !CONTROL.has(req.type)) throw new Error(`unknown request type: ${String(req.type)}`);
    req = validateRequest(req);
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
    send({ id: req.id, ok: true, data: runQuery(db, req) });
  } catch (e) {
    send({ id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
