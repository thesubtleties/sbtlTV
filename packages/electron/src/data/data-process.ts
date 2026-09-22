/**
 * Data process entry (Electron utilityProcess). Owns the SQLite file: this
 * thread holds the read connection and answers renderer queries over
 * MessagePorts; a worker thread holds the write connection and runs syncs.
 * Main only sends control messages and relays log lines.
 */
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MessagePortMain } from 'electron';
import type { Source, DataSettings, DataEvent, DataTable, ControlMessage, ControlReply, SyncProgress } from '@sbtltv/core';
import { openDatabase } from './db.js';
import { routeRendererMessage, type SyncJob } from './router.js';
import { dueSyncs } from './scheduler.js';
import { runQuery } from './queries.js';

const parent = process.parentPort;
if (!parent) throw new Error('data-process must run as an Electron utility process');
const tell = (m: ControlReply) => parent.postMessage(m);
const log = (category: string, message: string) => tell({ type: 'log', category, message });

let db: ReturnType<typeof openDatabase> | null = null;
let worker: Worker | null = null;
let sources: Source[] = [];
let settings: DataSettings | null = null;
let dbPath = '';
let tempDir = '';
const rendererPorts = new Set<MessagePortMain>();
let schedulerTimer: NodeJS.Timeout | null = null;
let stopping = false;
const SCHEDULER_INTERVAL_MS = 5 * 60_000;

function broadcast(ev: DataEvent): void {
  for (const p of rendererPorts) p.postMessage(ev);
}

function enqueue(job: SyncJob): void {
  worker?.postMessage({ type: 'job', job });
}

function scheduleDue(): void {
  if (!db || !settings || !worker) return;
  const metas = runQuery(db, { id: 0, type: 'syncStatus' }) as Parameters<typeof dueSyncs>[0];
  for (const d of dueSyncs(metas, sources, settings, Date.now())) {
    const name = sources.find((s) => s.id === d.sourceId)?.name ?? d.sourceId;
    if (d.channels) { log('sync', `Source ${name} is stale, syncing...`); enqueue({ kind: 'channels', sourceId: d.sourceId }); }
    if (d.vod) { log('vod', `Source ${name} is stale, syncing VOD...`); enqueue({ kind: 'vod', sourceId: d.sourceId }); }
  }
}

function startWorker(): void {
  const w = new Worker(path.join(path.dirname(fileURLToPath(import.meta.url)), 'sync-worker.js'), { resourceLimits: { maxOldGenerationSizeMb: 8192 } });
  worker = w;
  w.on('message', (m: { type: string } & Record<string, unknown>) => {
    switch (m.type) {
      case 'ready':
        // The worker opened the write connection first (integrity check and
        // migrations), so the read connection can open now.
        if (!db) {
          db = openDatabase(dbPath, { readOnly: true });
          tell({ type: 'ready' });
        }
        w.postMessage({ type: 'sources', sources });
        w.postMessage({ type: 'settings', settings });
        // Also reschedules whatever an earlier worker was doing when it died.
        scheduleDue();
        break;
      case 'log': log(m.category as string, m.message as string); break;
      case 'progress': { const progress = m.progress as SyncProgress; tell({ type: 'sync', progress }); broadcast({ kind: 'sync', progress }); break; }
      case 'changed': for (const table of m.tables as DataTable[]) broadcast({ kind: 'changed', table, sourceId: m.sourceId as string | null }); break;
      case 'idle': break;
    }
  });
  w.on('error', (e) => log('data', `sync worker error: ${e.stack ?? e.message}`));
  w.on('exit', (code) => {
    if (worker === w) worker = null;
    if (stopping) return;
    log('data', `sync worker exited with ${code}; restarting`);
    setTimeout(startWorker, 1000);
  });
  w.postMessage({ type: 'init', dbPath, tempDir, settings });
}

function attachRendererPort(port: MessagePortMain): void {
  rendererPorts.add(port);
  port.on('message', (e) => {
    if (!db) {
      const id = (e.data as { id?: unknown } | null)?.id;
      if (typeof id === 'number') port.postMessage({ id, ok: false, error: 'data process is still starting' });
      return;
    }
    routeRendererMessage(db, e.data, (reply) => port.postMessage(reply), enqueue, () => sources.filter((s) => s.enabled).map((s) => s.id));
  });
  port.on('close', () => rendererPorts.delete(port));
  port.start();
  port.postMessage({ kind: 'ready' } satisfies DataEvent);
}

parent.on('message', (e) => {
  const m = e.data as ControlMessage;
  switch (m.type) {
    case 'init':
      sources = m.sources; settings = m.settings; dbPath = m.dbPath; tempDir = m.tempDir;
      startWorker();
      schedulerTimer = setInterval(scheduleDue, SCHEDULER_INTERVAL_MS);
      break;
    case 'sources': {
      const gone = sources.filter((s) => !m.sources.some((n) => n.id === s.id));
      sources = m.sources;
      worker?.postMessage({ type: 'sources', sources });
      for (const s of gone) enqueue({ kind: 'deleteSource', sourceId: s.id });
      scheduleDue();
      break;
    }
    case 'settings': settings = m.settings; worker?.postMessage({ type: 'settings', settings }); break;
    case 'deleteSource': enqueue({ kind: 'deleteSource', sourceId: m.sourceId }); break;
    case 'renderer-port': for (const p of e.ports) attachRendererPort(p); break;
    case 'shutdown':
      stopping = true;
      if (schedulerTimer) clearInterval(schedulerTimer);
      worker?.postMessage({ type: 'shutdown' });
      db?.close();
      setTimeout(() => process.exit(0), 200);
      break;
  }
});

process.on('uncaughtException', (e) => {
  tell({ type: 'fatal', error: e.stack ?? e.message });
  process.exit(1);
});
