/**
 * Sync worker: one of the two threads that write to the data file. The data
 * process hands it one job at a time (see lanes.ts) and it reports log lines,
 * progress, changed tables, and completion back. Started with
 * workerData.role = 'sync' (bulk syncs) or 'quick' (on-demand jobs).
 */
import { parentPort, workerData } from 'node:worker_threads';
import type { Source, DataSettings, DataTable, SyncProgress } from '@sbtltv/core';
import { checkProviderUrl } from '@sbtltv/core';
import { setUrlGuard } from '@sbtltv/local-adapter';
import { openDatabase, runJob, setRedactor, type Db, type StageContext, type SyncJob } from '@sbtltv/data';
import { nodePlatform } from '@sbtltv/data/node';
import { cleanErrorText } from '../log-redact.js';

if (!parentPort) throw new Error('sync-worker must run as a worker thread');
const port = parentPort;
const post = (m: unknown) => port.postMessage(m);
const role: string = (workerData as { role?: string } | undefined)?.role ?? 'sync';

const platform = nodePlatform();
// Errors this thread stores (a source's sync error) are cleaned of logins first; the data package refuses to store
// one if this was never set.
setRedactor(cleanErrorText);

let db: Db | null = null;
let sources: Source[] = [];
let settings: DataSettings = { epgRefreshHours: 6, vodRefreshHours: 24, allowLanSources: false, debugLoggingEnabled: false };
let tempDir = '';
let tmdbPath = '';
let stagingDir = '';

function ctx(): StageContext {
  return {
    db: db!, platform, tempDir, tmdbPath, stagingDir, allowLanSources: settings.allowLanSources,
    log: (category, message) => post({ type: 'log', category, message }),
    // A failure's message reaches the page (an episode that failed to load shows it): logins never.
    progress: (progress: SyncProgress) => post({ type: 'progress', progress: progress.message ? { ...progress, message: cleanErrorText(progress.message) } : progress }),
    changed: (tables: DataTable[], sourceId) => post({ type: 'changed', tables, sourceId }),
  };
}

port.on('message', (m: { type: string } & Record<string, unknown>) => {
  switch (m.type) {
    case 'init':
      tempDir = m.tempDir as string;
      // The TMDB titles cache sits next to the data file (a cache: rebuilt when missing or damaged).
      tmdbPath = platform.files.join(platform.files.dirname(m.dbPath as string), 'tmdb-titles.sqlite');
      // Guide syncs stage into scratch files beside it (guide-staging.ts).
      stagingDir = platform.files.dirname(m.dbPath as string);
      settings = m.settings as DataSettings;
      // Provider requests made by the clients in this thread obey the LAN setting.
      setUrlGuard((url) => checkProviderUrl(url, settings.allowLanSources));
      try {
        db = openDatabase(platform, m.dbPath as string, { readOnly: false, busyTimeoutMs: 120_000, recover: role === 'sync', log: (msg) => post({ type: 'log', category: 'data', message: msg }), onReset: (reason) => post({ type: 'reset', reason }) });
      } catch (e) {
        // A migration that fails or a file newer than this build: report and
        // stop; the data process decides whether that is fatal for the app.
        post({ type: 'fatal', error: `${role} worker could not open the data file: ${e instanceof Error ? e.stack ?? e.message : String(e)}` });
        return;
      }
      post({ type: 'ready' });
      break;
    case 'sources': sources = m.sources as Source[]; break;
    case 'settings': settings = m.settings as DataSettings; break;
    case 'job': {
      const job = m.job as SyncJob;
      runJob(ctx(), sources, job)
        .catch((e) => post({ type: 'log', category: 'sync', message: `Job ${job.kind} crashed: ${e instanceof Error ? e.stack ?? e.message : String(e)}` }))
        .finally(() => post({ type: 'job-finished', job }));
      break;
    }
    case 'shutdown': db?.close(); process.exit(0);
  }
});
