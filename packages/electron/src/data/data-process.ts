/**
 * Data process entry (Electron utilityProcess). Owns the SQLite file: this
 * thread holds the read connection and answers renderer queries over
 * MessagePorts; two worker threads hold write connections and run jobs, one
 * lane for bulk syncs and one for on-demand work (see lanes.ts). Main only
 * sends control messages and relays log lines.
 */
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MessagePortMain } from 'electron';
import type { Source, DataSettings, DataEvent, DataTable, ControlMessage, ControlReply, SyncProgress } from '@sbtltv/core';

const platform = nodePlatform();
import { openDatabase, routeRendererMessage, JobLanes, dueJobs, deletedSourceIds, workerStoppedProgress, type Db, type LaneName, type SyncJob } from '@sbtltv/data';
import { nodePlatform } from '@sbtltv/data/node';
import { needsLogin } from '@sbtltv/core';

const parent = process.parentPort;
if (!parent) throw new Error('data-process must run as an Electron utility process');
const tell = (m: ControlReply) => parent.postMessage(m);
const log = (category: string, message: string) => tell({ type: 'log', category, message });

let db: Db | null = null;
let sources: Source[] = [];
let settings: DataSettings | null = null;
let dbPath = '';
let tempDir = '';
let readyTold = false;
const rendererPorts = new Set<MessagePortMain>();
let schedulerTimer: NodeJS.Timeout | null = null;
let stopping = false;
const SCHEDULER_INTERVAL_MS = 5 * 60_000;
// The worker heap: a 3GB guide is streamed, but its matched programmes (a few
// hundred thousand objects) and the TMDB export maps live in memory at once.
const WORKER_HEAP_MB = 8192;

interface LaneWorker { worker: Worker | null; restarts: number; timer: NodeJS.Timeout | null }
const workers: Record<LaneName, LaneWorker> = {
  sync: { worker: null, restarts: 0, timer: null },
  quick: { worker: null, restarts: 0, timer: null },
};

function broadcast(ev: DataEvent): void {
  for (const p of rendererPorts) p.postMessage(ev);
}

const lanes = new JobLanes({
  send: (lane, job) => workers[lane].worker?.postMessage({ type: 'job', job }),
  // The worker died mid-job: tell the renderer the stage failed so its banner
  // clears; the lane re-runs the job once its replacement worker is ready.
  failed: (job) => {
    const progress = workerStoppedProgress(job);
    if (!progress) return;
    tell({ type: 'sync', progress });
    broadcast({ kind: 'sync', progress });
  },
});

const enqueue = (job: SyncJob): void => { lanes.enqueue(job); };

function scheduleDue(): void {
  if (!db || !settings) return;
  for (const d of dueJobs(db, sources, settings, Date.now())) { log(d.category, d.message); enqueue(d.job); }
}

// Rows for sources that are no longer configured (a delete that arrived while
// the process was down) are removed. Skipped when main hands over no sources at
// all, so a transient empty list can never wipe the file.
function reconcileSources(): void {
  if (!db) return;
  for (const id of deletedSourceIds(db, sources)) { log('data', `removing rows of deleted source ${id}`); enqueue({ kind: 'deleteSource', sourceId: id }); }
}

// The read connection is (re)opened whenever the bulk worker comes up: a
// restart may have moved a corrupt file aside and created a fresh one.
function openReadConnection(): void {
  try { db?.close(); } catch { /* already closed */ }
  db = openDatabase(platform, dbPath, { readOnly: true });
  if (!readyTold) { readyTold = true; tell({ type: 'ready' }); }
}

function startWorker(lane: LaneName): void {
  const slot = workers[lane];
  const w = new Worker(path.join(path.dirname(fileURLToPath(import.meta.url)), 'sync-worker.js'), { workerData: { role: lane }, resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB } });
  slot.worker = w;
  w.on('message', (m: { type: string } & Record<string, unknown>) => {
    switch (m.type) {
      case 'ready':
        slot.restarts = 0;
        w.postMessage({ type: 'sources', sources });
        w.postMessage({ type: 'settings', settings });
        if (lane === 'sync') {
          // The bulk worker opened the write connection first (integrity check
          // and migrations), so the read connection can open now.
          openReadConnection();
          reconcileSources();
          scheduleDue();
          if (!workers.quick.worker && !workers.quick.timer) startWorker('quick');
        }
        lanes.setReady(lane);
        break;
      case 'job-finished': lanes.finished(lane); break;
      case 'fatal': {
        const error = m.error as string;
        log('data', error);
        if (lane === 'sync') {
          // Without the bulk worker there is no database: stop the whole process
          // and let main log it; main will not restart after a fatal report.
          tell({ type: 'fatal', error });
          setTimeout(() => process.exit(1), 100);
        } else {
          lanes.dead('quick');
        }
        break;
      }
      case 'log': log(m.category as string, m.message as string); break;
      case 'reset': tell({ type: 'reset', reason: m.reason as string }); break;
      case 'progress': { const progress = m.progress as SyncProgress; tell({ type: 'sync', progress }); broadcast({ kind: 'sync', progress }); break; }
      case 'changed': for (const table of m.tables as DataTable[]) broadcast({ kind: 'changed', table, sourceId: m.sourceId as string | null }); break;
    }
  });
  w.on('error', (e) => log('data', `${lane} worker error: ${e.stack ?? e.message}`));
  w.on('exit', (code) => {
    if (slot.worker === w) slot.worker = null;
    if (stopping) return;
    lanes.crashed(lane);
    slot.restarts++;
    const delay = Math.min(30_000, 1000 * 2 ** (slot.restarts - 1));
    log('data', `${lane} worker exited with ${code}; restarting in ${delay}ms`);
    slot.timer = setTimeout(() => { slot.timer = null; startWorker(lane); }, delay);
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
    routeRendererMessage(db, e.data, (reply) => port.postMessage(reply), enqueue, () => sources.filter((s) => s.enabled && !needsLogin(s)).map((s) => s.id));
  });
  port.on('close', () => rendererPorts.delete(port));
  port.start();
  port.postMessage({ kind: 'ready' } satisfies DataEvent);
}

function shutdown(): void {
  stopping = true;
  if (schedulerTimer) clearInterval(schedulerTimer);
  const alive = (['sync', 'quick'] as LaneName[]).map((lane) => workers[lane]).filter((s) => s.worker);
  for (const s of (['sync', 'quick'] as LaneName[]).map((l) => workers[l])) { if (s.timer) clearTimeout(s.timer); }
  let remaining = alive.length;
  const finish = () => { try { db?.close(); } catch { /* ignore */ } process.exit(0); };
  if (remaining === 0) { finish(); return; }
  // Workers close their write connections and exit; give them a moment, then go.
  const deadline = setTimeout(finish, 1500);
  for (const s of alive) {
    s.worker!.once('exit', () => { if (--remaining === 0) { clearTimeout(deadline); finish(); } });
    s.worker!.postMessage({ type: 'shutdown' });
  }
}

parent.on('message', (e) => {
  const m = e.data as ControlMessage;
  switch (m.type) {
    case 'init':
      sources = m.sources; settings = m.settings; dbPath = m.dbPath; tempDir = m.tempDir;
      startWorker('sync');
      schedulerTimer = setInterval(scheduleDue, SCHEDULER_INTERVAL_MS);
      break;
    case 'sources': {
      const gone = sources.filter((s) => !m.sources.some((n) => n.id === s.id));
      sources = m.sources;
      for (const lane of ['sync', 'quick'] as LaneName[]) workers[lane].worker?.postMessage({ type: 'sources', sources });
      for (const s of gone) enqueue({ kind: 'deleteSource', sourceId: s.id });
      scheduleDue();
      break;
    }
    case 'settings':
      settings = m.settings;
      for (const lane of ['sync', 'quick'] as LaneName[]) workers[lane].worker?.postMessage({ type: 'settings', settings });
      scheduleDue();
      break;
    case 'deleteSource': enqueue({ kind: 'deleteSource', sourceId: m.sourceId }); break;
    case 'renderer-port': for (const p of e.ports) attachRendererPort(p); break;
    case 'shutdown': shutdown(); break;
  }
});

process.on('uncaughtException', (e) => {
  tell({ type: 'fatal', error: e.stack ?? e.message });
  process.exit(1);
});
