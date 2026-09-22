/**
 * Renderer side of the data process protocol: typed requests over a
 * MessagePort, replies matched by id, change events fanned out to subscribers.
 */
import type { DataRequest, DataRequestBody, DataReply, DataEvent, DataTable, ReplyForBody, SyncProgress } from '@sbtltv/core';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; type: DataRequest['type'] };

const DATE_FIELDS: Partial<Record<DataRequest['type'], string[]>> = {
  programsInRange: ['start', 'end'],
  currentProgram: ['start', 'end'],
  movies: ['added', 'match_attempted'],
  series: ['added', 'match_attempted'],
};

// Rows cross the port with integer milliseconds; the hooks' contracts have Dates.
function revive(type: DataRequest['type'], data: unknown): unknown {
  if (type === 'syncStatus') {
    return (data as Record<string, unknown>[]).map((r) => {
      const epgOrChannel = r.last_epg_sync ?? r.last_channel_sync;
      return {
        source_id: r.source_id, epg_url: r.epg_url ?? undefined,
        last_synced: epgOrChannel != null ? new Date(Number(epgOrChannel)) : undefined,
        vod_last_synced: r.last_vod_sync != null ? new Date(Number(r.last_vod_sync)) : undefined,
        channel_count: r.channel_count, category_count: r.category_count,
        vod_movie_count: r.movie_count, vod_series_count: r.series_count, error: r.error ?? undefined,
      };
    });
  }
  const fields = DATE_FIELDS[type];
  if (!fields || data == null) return data;
  const fix = (row: Record<string, unknown>) => { for (const f of fields) if (row[f] != null) row[f] = new Date(Number(row[f])); return row; };
  return Array.isArray(data) ? data.map((r) => fix(r as Record<string, unknown>)) : fix(data as Record<string, unknown>);
}

export class DataClient {
  private port: MessagePort | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private queued: unknown[] = [];
  private subs = new Map<DataTable, Set<() => void>>();
  private syncSubs = new Set<(p: SyncProgress) => void>();
  private readyResolve!: () => void;
  ready: Promise<void> = new Promise((r) => { this.readyResolve = r; });

  attach(port: MessagePort): void {
    this.port = port;
    port.addEventListener('message', (e: MessageEvent) => this.onMessage(e.data));
    port.start();
    for (const m of this.queued.splice(0)) port.postMessage(m);
    this.readyResolve();
    // A fresh port (after a data process restart) invalidates everything on screen.
    for (const set of this.subs.values()) for (const cb of set) cb();
  }

  private onMessage(msg: unknown): void {
    const reply = msg as DataReply;
    if (typeof (reply as { id?: unknown }).id === 'number') {
      const p = this.pending.get(reply.id);
      if (!p) return;
      this.pending.delete(reply.id);
      if (reply.ok) p.resolve(revive(p.type, reply.data)); else p.reject(new Error(reply.error));
      return;
    }
    const ev = msg as DataEvent;
    if (ev.kind === 'changed') { for (const cb of this.subs.get(ev.table) ?? []) cb(); }
    else if (ev.kind === 'sync') { for (const cb of this.syncSubs) cb(ev.progress); }
  }

  // Queries sent before the port arrives wait for it.
  query<B extends DataRequestBody>(req: B): Promise<ReplyForBody<B>> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, type: req.type });
      const envelope = { ...req, id };
      if (this.port) this.port.postMessage(envelope); else this.queued.push(envelope);
    });
  }

  subscribe(tables: DataTable[], cb: () => void): () => void {
    for (const t of tables) (this.subs.get(t) ?? this.subs.set(t, new Set()).get(t)!).add(cb);
    return () => { for (const t of tables) this.subs.get(t)?.delete(cb); };
  }

  onSync(cb: (p: SyncProgress) => void): () => void {
    this.syncSubs.add(cb);
    return () => { this.syncSubs.delete(cb); };
  }
}

export const data = new DataClient();

// The preload forwards the port with window.postMessage('data-port', '*', [port]).
if (typeof window !== 'undefined') {
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data === 'data-port' && e.ports[0]) data.attach(e.ports[0]);
  });
  window.data?.requestPort();
}
