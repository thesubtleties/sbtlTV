import { File, Paths } from 'expo-file-system';
import { Platform as RNPlatform } from 'react-native';
import type { SyncJob } from '@sbtltv/data';
import SbtlNative from '../../modules/sbtl-native';
import { createHost } from '../host/host';
import { readTestLogins, sendToTestComputer } from './handoff';
import { openRnDb } from '../platform/db';
import { startMeasure } from './measure';

export interface StageResult { stage: string; ms: number; peakPssMb: number; peakJsHeapMb: number; longestFreezeMs: number; counts: Record<string, number>; diskMb: Record<string, number> }
export interface QueryResult { query: string; ms: number; rows: number; ok: boolean; error?: string }

const docs = () => Paths.document.uri.replace(/^file:\/\//, '').replace(/\/$/, '');
const mb = (b: number) => Math.round((b / 1048576) * 10) / 10;

// The stick test: the real sync stages in desktop order, then the TV's real queries; results to stick-results.json.
export async function runStickTest(status: (s: string) => void): Promise<void> {
  const logs: string[] = [];
  const log = (c: string, m: string) => { logs.push(`${new Date().toISOString()} [${c}] ${m}`); if (logs.length > 20000) logs.shift(); };
  // Results go to the private documents and to the external files folder (adb pulls them from there; no secrets).
  const write = async (name: string, text: string) => {
    const f = new File(Paths.document, name); f.create({ overwrite: true }); f.write(text);
    await sendToTestComputer(name, text);
  };
  const idle = SbtlNative.memoryInfo();
  const host = await createHost({ sources: await readTestLogins(), onLog: log, onProgress: (p) => { log('progress', JSON.stringify(p)); status(`${p.stage} ${p.state}${p.message ? ': ' + p.message : ''}`); } });
  const dataFile = `${docs()}/sbtltv-data.sqlite`;
  const read = openRnDb(dataFile, { readOnly: true, busyTimeoutMs: 5000 });
  const count = (sql: string) => (read.prepare(sql).get() as { c: number }).c;
  const size = (p: string) => (new File(`file://${p}`).exists ? new File(`file://${p}`).size ?? 0 : 0);
  const counts = () => ({
    channels: count('select count(*) c from channels'), programmes: count('select count(*) c from epg_programs'), links: count('select count(*) c from epg_links'),
    movies: count('select count(*) c from vod_movies'), series: count('select count(*) c from vod_series'),
    moviesMatched: count('select count(*) c from vod_movies where tmdb_id is not null'), seriesMatched: count('select count(*) c from vod_series where tmdb_id is not null'),
  });
  const disk = () => ({ data: mb(size(dataFile) + size(`${dataFile}-wal`)), tmdb: mb(size(`${docs()}/tmdb-titles.sqlite`)), free: mb(SbtlNative.memoryInfo().freeDiskBytes) });
  const stages: StageResult[] = [];
  const stage = async (name: string, job: SyncJob) => {
    status(`running ${name}...`); const stop = startMeasure(); const t0 = Date.now();
    await host.runJob(job);
    const m = stop(); stages.push({ stage: name, ms: Date.now() - t0, ...m, counts: counts(), diskMb: disk() });
    log('stick', `stage ${name}: ${JSON.stringify(stages[stages.length - 1])}`);
  };
  for (const s of host.sources) {
    await stage(`channels+guide ${s.id.slice(0, 8)}`, { kind: 'channels', sourceId: s.id });
    if (s.type === 'xtream') await stage(`vod+tmdb ${s.id.slice(0, 8)}`, { kind: 'vod', sourceId: s.id });
  }
  const queries: QueryResult[] = [];
  let id = 1;
  const q = (name: string, req: Record<string, unknown>) => {
    const stop = startMeasure(); const t0 = Date.now();
    const reply = host.query({ id: id++, ...req } as { id: number; type: string });
    stop();
    const data = reply && reply.ok ? reply.data : undefined;
    const rows = Array.isArray(data) ? data.length : data && typeof data === 'object' ? Object.values(data as object).reduce((n: number, v) => n + (Array.isArray(v) ? v.length : 0), 0) : typeof data === 'number' ? data : 0;
    queries.push({ query: name, ms: Date.now() - t0, rows, ok: !!reply?.ok, error: reply && !reply.ok ? reply.error : undefined });
    return data;
  };
  const sourceIds = host.sources.map((s) => s.id);
  const cats = (q('categories', { type: 'categories', sourceIds }) as { category_id: string }[] | undefined) ?? [];
  const chans = (q('channels of the first category', { type: 'channels', categoryId: cats[0]?.category_id ?? null, sourceIds, sort: 'number' }) as { stream_id: string }[] | undefined) ?? [];
  const now = Date.now();
  q('guide window: 50 channels x 6 h', { type: 'programsInRange', streamIds: chans.slice(0, 50).map((c) => c.stream_id), windowStartMs: now, windowEndMs: now + 6 * 3600_000 });
  q('guide search "news"', { type: 'guideSearch', query: 'news', sourceIds, nowMs: now, hideAdult: true });
  const vcats = (q('movie categories', { type: 'vodCategories', kind: 'movie', sourceIds }) as { category_id: string }[] | undefined) ?? [];
  q('movies of the first category', { type: 'movies', by: { kind: 'categories', categoryIds: vcats.slice(0, 1).map((c) => c.category_id) }, sourceIds, limit: 200 });
  const series = (q('series (all, 50)', { type: 'series', by: { kind: 'all' }, sourceIds, limit: 50 }) as { series_id: string }[] | undefined) ?? [];
  if (series[0]) {
    await stage('episodes (first series)', { kind: 'episodes', sourceId: sourceIds[0], seriesId: series[0].series_id });
    q('episodes of the first series', { type: 'episodes', seriesIds: [series[0].series_id] });
  }
  const results = {
    device: { ...(RNPlatform.constants as object), idlePssMb: Math.round(idle.pssKb / 1024) },
    stages, queries,
    gaps: ['LAN guard on provider API calls (local-adapter fetch follows redirects itself on RN)', 'provider lists (VOD/live JSON) held whole in memory', 'TV log keeps provider hostnames in error text (desktop labels them in main): label before any log sharing'],
  };
  await write('stick-results.json', JSON.stringify(results, null, 2));
  await write('stick-log.txt', logs.join('\n'));
  read.close(); host.close();
  console.log('RESULTS written ' + JSON.stringify({ stages: stages.map((s) => [s.stage, s.ms, s.peakPssMb, s.longestFreezeMs]) }));
  status('done: results written');
}
