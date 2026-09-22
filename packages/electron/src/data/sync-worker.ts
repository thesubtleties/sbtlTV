/**
 * Sync worker: the one thread that writes to the data file. Runs sync jobs one
 * at a time on request from the data process and reports log lines, progress,
 * and changed tables back to it.
 */
import { parentPort } from 'node:worker_threads';
import type { Source, DataSettings, DataTable, SyncProgress, Channel } from '@sbtltv/core';
import { configureTmdbExportFetch } from '@sbtltv/core';
import { openDatabase } from './db.js';
import type { StageContext } from './sync-channels.js';
import { syncChannels, makeXtreamClient } from './sync-channels.js';
import { syncEpg } from './sync-epg.js';
import { syncVod, syncEpisodes, matchTmdb } from './sync-vod.js';
import { deleteSource, clearAll } from './writes.js';
import type { SyncJob } from './router.js';

if (!parentPort) throw new Error('sync-worker must run as a worker thread');
const port = parentPort;
const post = (m: unknown) => port.postMessage(m);

let db: ReturnType<typeof openDatabase> | null = null;
let sources: Source[] = [];
let settings: DataSettings = { epgRefreshHours: 6, vodRefreshHours: 24, allowLanSources: false, debugLoggingEnabled: false };
let tempDir = '';
const queue: SyncJob[] = [];
let running = false;

function ctx(): StageContext {
  return {
    db: db!, tempDir, allowLanSources: settings.allowLanSources,
    log: (category, message) => post({ type: 'log', category, message }),
    progress: (progress: SyncProgress) => post({ type: 'progress', progress }),
    changed: (tables: DataTable[], sourceId) => post({ type: 'changed', tables, sourceId }),
  };
}

// The guide selection mirrors sync.ts: auto-load means the panel's built-in
// guide for Xtream (or the playlist's url-tvg for M3U); a manual override URL
// is used only when auto-load is off.
async function syncGuide(c: StageContext, source: Source, channels: Channel[], playlistEpgUrl: string | undefined): Promise<void> {
  const shouldLoadEpg = source.auto_load_epg ?? source.type === 'xtream';
  if (shouldLoadEpg && source.type === 'xtream') {
    const url = makeXtreamClient(source)?.getEpgUrl();
    if (url) await syncEpg(c, source, channels, url, `xtream://${source.url}`);
  } else if (shouldLoadEpg && playlistEpgUrl) {
    await syncEpg(c, source, channels, playlistEpgUrl, playlistEpgUrl);
  }
  if (source.epg_url && !shouldLoadEpg) {
    await syncEpg(c, source, channels, source.epg_url, source.epg_url);
  }
}

async function run(job: SyncJob): Promise<void> {
  const c = ctx();
  if (job.kind === 'deleteSource') { c.changed(deleteSource(db!, job.sourceId), job.sourceId); return; }
  if (job.kind === 'clearAll') { c.changed(clearAll(db!), null); return; }
  const source = sources.find((s) => s.id === job.sourceId);
  if (!source) { c.log('sync', `Job ${job.kind} for unknown source ${job.sourceId} skipped`); return; }
  switch (job.kind) {
    case 'channels': {
      const out = await syncChannels(c, source, makeXtreamClient(source));
      if (!out) return;
      await syncGuide(c, source, out.channels, out.epgUrl);
      return;
    }
    case 'vod': {
      const client = makeXtreamClient(source);
      if (!client) return;
      const out = await syncVod(c, source, client);
      if (out) await matchTmdb(c, source);
      return;
    }
    case 'episodes': {
      const client = makeXtreamClient(source);
      if (client) await syncEpisodes(c, source, client, job.seriesId);
      return;
    }
    case 'rematch': {
      c.log('epg', `Starting EPG rematch for source: ${source.name || source.id}`);
      const rows = db!.prepare(`select stream_id, source_id, name, stream_icon, epg_channel_id, direct_url from channels where source_id = ?`).all(source.id) as { stream_id: string; source_id: string; name: string; stream_icon: string; epg_channel_id: string; direct_url: string }[];
      if (rows.length === 0) { c.log('epg', 'No channels found for source, nothing to rematch'); return; }
      const channels: Channel[] = rows.map((r) => ({ ...r, category_ids: [] }));
      const meta = db!.prepare(`select epg_url from sources_meta where source_id = ?`).get(source.id) as { epg_url?: string | null } | undefined;
      if (source.epg_url) await syncEpg(c, source, channels, source.epg_url, source.epg_url);
      else if (source.type === 'xtream') await syncGuide(c, source, channels, undefined);
      else if (meta?.epg_url) await syncEpg(c, source, channels, meta.epg_url, meta.epg_url);
      else c.log('epg', 'No EPG URL known for source, nothing to rematch');
      return;
    }
  }
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  while (queue.length > 0) {
    const job = queue.shift()!;
    try { await run(job); } catch (e) { post({ type: 'log', category: 'sync', message: `Job ${job.kind} crashed: ${e instanceof Error ? e.stack ?? e.message : String(e)}` }); }
  }
  running = false;
  post({ type: 'idle' });
}

port.on('message', (m: { type: string } & Record<string, unknown>) => {
  switch (m.type) {
    case 'init':
      tempDir = m.tempDir as string;
      settings = m.settings as DataSettings;
      db = openDatabase(m.dbPath as string, { readOnly: false, log: (msg) => post({ type: 'log', category: 'data', message: msg }) });
      configureTmdbExportFetch({
        async fetchText(url) { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); },
        async fetchBinary(url) { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return new Uint8Array(await r.arrayBuffer()); },
      });
      post({ type: 'ready' });
      break;
    case 'sources': sources = m.sources as Source[]; break;
    case 'settings': settings = m.settings as DataSettings; break;
    case 'job': queue.push(m.job as SyncJob); void pump(); break;
    case 'shutdown': db?.close(); process.exit(0);
  }
});
