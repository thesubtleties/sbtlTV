import { Paths } from 'expo-file-system';
import { checkProviderUrl, type Source, type SyncProgress, type DataSettings, type DataReply } from '@sbtltv/core';
import { setUrlGuard } from '@sbtltv/local-adapter';
import { openDatabase, routeRendererMessage, runJob, setRedactor, sweepStagingFiles, type Db, type StageContext, type SyncJob } from '@sbtltv/data';
import { cleanErrorText } from '../../../electron/src/log-redact';
import { rnPlatform } from '../platform';

export interface DataHost { sources: Source[]; dataDir: string; runJob(job: SyncJob): Promise<void>; query(req: { id: number; type: string } & Record<string, unknown>): DataReply | undefined; close(): void }

// The sources come from the caller (the real app's own setup later; the debug screen's handoff for the stick test).
export async function createHost(opts: { sources: Source[]; onLog(cat: string, msg: string): void; onProgress(p: SyncProgress): void }): Promise<DataHost> {
  const platform = rnPlatform();
  const dataDir = Paths.document.uri.replace(/^file:\/\//, '').replace(/\/$/, '');
  const tempDir = Paths.cache.uri.replace(/^file:\/\//, '').replace(/\/$/, '');
  const dbPath = `${dataDir}/sbtltv-data.sqlite`;
  setRedactor(cleanErrorText);
  const settings: DataSettings = { epgRefreshHours: 6, vodRefreshHours: 24, allowLanSources: false, debugLoggingEnabled: true };
  setUrlGuard((url) => checkProviderUrl(url, settings.allowLanSources));
  sweepStagingFiles(platform, dataDir);
  const writer: Db = openDatabase(platform, dbPath, { readOnly: false, busyTimeoutMs: 120_000, recover: true, log: (m) => opts.onLog('data', m) });
  const reader: Db = openDatabase(platform, dbPath, { readOnly: true, busyTimeoutMs: 5000 });
  const sources = opts.sources;
  const ctx: StageContext = {
    db: writer, platform, tempDir, tmdbPath: `${dataDir}/tmdb-titles.sqlite`, stagingDir: dataDir, allowLanSources: settings.allowLanSources,
    log: (c, m) => opts.onLog(c, cleanErrorText(m)),
    progress: (p) => opts.onProgress(p.message ? { ...p, message: cleanErrorText(p.message) } : p),
    changed: () => {},
  };
  return {
    sources, dataDir,
    runJob: (job) => runJob(ctx, sources, job),
    // The router answers through `send` (synchronously for reads); control requests it would queue are ignored here.
    query: (req) => { let reply: DataReply | undefined; routeRendererMessage(reader, req, (r) => { reply = r; }, () => {}); return reply; },
    close: () => { reader.close(); writer.close(); },
  };
}
