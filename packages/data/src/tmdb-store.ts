/**
 * TMDB titles cache for VOD matching: tmdb-titles.sqlite next to the data file. One table per kind, loaded from the
 * gzipped NDJSON exports in batches through a staging table and swapped in by rename, so memory stays at one read
 * chunk plus one batch. A cache only: a damaged file is deleted and rebuilt.
 */
import { normalizeTitle } from '@sbtltv/core';
import type { Db, Log, Platform, Statement } from './platform.js';
import { decompressToFile, downloadToTempFile, type TempFileOptions } from './epg.js';
import { readLines } from './lines.js';

export type TitleKind = 'movie' | 'series';
export type TitleOrigin = 'enriched' | 'tmdb';
export interface TitleSource { url: string; origin: TitleOrigin }
export interface TitleSources { enriched: TitleSource; tmdb: TitleSource }
export interface LoadOptions { tempDir: string; allowLan: boolean; log: Log; nowMs: number }

export const TMDB_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// How long a table with years is kept while the cache repo can't be reached, before TMDB's own (year-less) export is
// used: stale good matches beat wrong ones on common titles. If the repo is ever gone for this long, it gets rehosted.
export const TMDB_STALE_MAX_MS = 7 * TMDB_MAX_AGE_MS;
// Real export lines are under 200 characters. Longer is junk: skipped below 64 KiB, a failed load above.
const MAX_TITLE_LINE = 4096;
const MAX_LINE = 64 * 1024;
const BATCH_ROWS = 5000;
const CHUNK_BYTES = 256 * 1024;
const DOWNLOAD: TempFileOptions = { prefix: 'tmdb', maxBytes: 256 * 1024 * 1024, label: 'TMDB download' };
const DECOMPRESS: TempFileOptions = { prefix: 'tmdb-ndjson', maxBytes: 1024 * 1024 * 1024, label: 'TMDB decompression' };
const CACHE_REPO = 'https://raw.githubusercontent.com/thesubtleties/sbtlTV-tmdb-cache/main/data';

export function titleTable(kind: TitleKind): 'movie_titles' | 'series_titles' {
  return kind === 'movie' ? 'movie_titles' : 'series_titles';
}

// TMDB's own export is named by date; yesterday's is the newest one sure to exist (as the old code did).
export function titleSources(kind: TitleKind, nowMs: number): TitleSources {
  const d = new Date(nowMs); d.setDate(d.getDate() - 1);
  const date = `${String(d.getMonth() + 1).padStart(2, '0')}_${String(d.getDate()).padStart(2, '0')}_${d.getFullYear()}`;
  return {
    enriched: { url: `${CACHE_REPO}/tmdb-${kind === 'movie' ? 'movies' : 'tvs'}-enriched.ndjson.gz`, origin: 'enriched' },
    tmdb: { url: `https://files.tmdb.org/p/exports/${kind === 'movie' ? 'movie_ids' : 'tv_series_ids'}_${date}.json.gz`, origin: 'tmdb' },
  };
}

function removeFile(platform: Platform, path: string): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) platform.files.remove(path + suffix);
}

function tryOpen(platform: Platform, path: string): Db {
  const db = platform.openDb(path, { readOnly: false, busyTimeoutMs: 5000 });
  try {
    if ((db.prepare('pragma quick_check').get() as { quick_check: string }).quick_check !== 'ok') throw new Error('quick_check failed');
    // Set before the first table exists (it only applies to a new file): the space a daily reload frees is given back
    // after each swap, so the file stays at one copy of the titles instead of two.
    db.exec('pragma auto_vacuum = incremental');
    db.exec('create table if not exists meta(kind text primary key, loaded_at integer not null, origin text not null)');
    return db;
  } catch (e) {
    try { db.close(); } catch { /* already unusable */ }
    throw e;
  }
}

export function openTitles(platform: Platform, path: string, log: Log): Db {
  try {
    return tryOpen(platform, path);
  } catch {
    removeFile(platform, path);
    log('TMDB titles cache was unreadable; removed it, it is rebuilt on the next match');
    return tryOpen(platform, path);
  }
}

export function titlesMeta(db: Db, kind: TitleKind): { loadedAt: number; origin: TitleOrigin } | null {
  const row = db.prepare('select loaded_at, origin from meta where kind = ?').get(kind) as { loaded_at: number; origin: TitleOrigin } | undefined | null;
  return row ? { loadedAt: row.loaded_at, origin: row.origin } : null;
}

// A loaded_at in the future means the clock moved back: reload rather than trust it for days.
export function isFresh(loadedAt: number, nowMs: number): boolean {
  return loadedAt <= nowMs && nowMs - loadedAt < TMDB_MAX_AGE_MS;
}

interface TitleRow { norm: string; id: number; year: number | null; popularity: number }

function parseLine(line: string, kind: TitleKind, origin: TitleOrigin): TitleRow | null {
  if (!line || line.length > MAX_TITLE_LINE) return null;
  let e: Record<string, unknown>;
  try { e = JSON.parse(line) as Record<string, unknown>; } catch { return null; }
  if (!e || typeof e !== 'object') return null;
  let id: unknown; let title: unknown; let year: number | null = null; let popularity: unknown;
  if (origin === 'enriched') {
    id = e.i; title = e.t; popularity = e.p;
    year = typeof e.y === 'number' ? e.y : null;
  } else {
    if (e.adult) return null;
    id = e.id; title = kind === 'movie' ? e.original_title : e.original_name; popularity = e.popularity;
  }
  if (typeof id !== 'number' || typeof title !== 'string') return null;
  const norm = normalizeTitle(title);
  if (!norm) return null;
  return { norm, id, year, popularity: typeof popularity === 'number' ? popularity : 0 };
}

// Writes one batch in its own synchronous transaction (never an await inside a transaction).
function writeBatch(db: Db, ins: Statement, batch: TitleRow[]): void {
  db.exec('begin immediate');
  try {
    for (const r of batch) ins.run(r.norm, r.id, r.year, r.popularity);
    db.exec('commit');
  } catch (e) {
    db.exec('rollback');
    throw e;
  }
}

// Loads one kind from `src` and swaps it in. Throws on any failure, leaving the old table and meta as they were.
export async function loadTitles(platform: Platform, db: Db, kind: TitleKind, src: TitleSource, opts: LoadOptions): Promise<number> {
  const table = titleTable(kind);
  const next = `${table}_next`;
  const temps: string[] = [];
  try {
    const gz = await downloadToTempFile(platform, src.url, opts.tempDir, opts.log, opts.allowLan, DOWNLOAD);
    temps.push(gz);
    const { xmlPath } = await decompressToFile(platform, gz, opts.log, DECOMPRESS);
    temps.push(xmlPath);
    db.exec(`drop table if exists ${next}`);
    db.exec(`create table ${next}(norm text not null, id integer not null, year integer, popularity real not null)`);
    const ins = db.prepare(`insert into ${next}(norm, id, year, popularity) values (?, ?, ?, ?)`);
    let count = 0;
    let batch: TitleRow[] = [];
    for await (const line of readLines(platform, xmlPath, CHUNK_BYTES, MAX_LINE)) {
      const row = parseLine(line, kind, src.origin);
      if (!row) continue;
      batch.push(row);
      if (batch.length >= BATCH_ROWS) { writeBatch(db, ins, batch); count += batch.length; batch = []; }
    }
    if (batch.length) { writeBatch(db, ins, batch); count += batch.length; }
    // The unpacked export (~70 MB) goes before the swap: the swap and vacuum need room of their own.
    await platform.files.removeAsync(xmlPath).catch(() => {});
    if (count === 0) throw new Error(`TMDB ${kind} export had no usable rows`);
    db.exec('begin immediate');
    try {
      db.exec(`drop table if exists ${table}`);
      db.exec(`alter table ${next} rename to ${table}`);
      db.exec(`create index ${table}_norm on ${table}(norm)`);
      db.prepare('insert into meta(kind, loaded_at, origin) values (?, ?, ?) on conflict(kind) do update set loaded_at = excluded.loaded_at, origin = excluded.origin').run(kind, opts.nowMs, src.origin);
      db.exec('commit');
    } catch (e) {
      db.exec('rollback');
      throw e;
    }
    db.exec('pragma incremental_vacuum');
    opts.log(`TMDB match: loaded ${count} ${kind} titles (${src.origin})`);
    return count;
  } catch (e) {
    try { db.exec(`drop table if exists ${next}`); db.exec('pragma incremental_vacuum'); } catch { /* the next load drops it */ }
    throw e;
  } finally {
    for (const t of temps) await platform.files.removeAsync(t).catch(() => {});
  }
}

// Makes the kind's titles usable. Fresh enriched titles are used as they are; otherwise the cache repo is tried. When it
// can't be reached, a table with years is kept for up to 7 days, and a year-less table for a day. Only past that, or
// with no table at all, is TMDB's own (year-less) export loaded; failing that too, whatever table there is still serves.
export async function ensureTitles(platform: Platform, db: Db, kind: TitleKind, sources: TitleSources, opts: LoadOptions): Promise<'fresh' | 'loaded' | 'stale' | 'none'> {
  const meta = titlesMeta(db, kind);
  if (meta && meta.origin === 'enriched' && isFresh(meta.loadedAt, opts.nowMs)) return 'fresh';
  const fail = (e: unknown) => opts.log(`TMDB match: ${kind} titles load failed: ${e instanceof Error ? e.message : String(e)}`);
  try { await loadTitles(platform, db, kind, sources.enriched, opts); return 'loaded'; } catch (e) { fail(e); }
  const useCached = () => { opts.log(`TMDB match: using cached ${kind} titles from ${new Date(meta!.loadedAt).toISOString().slice(0, 10)}`); return 'stale' as const; };
  if (meta) {
    const keepFor = meta.origin === 'enriched' ? TMDB_STALE_MAX_MS : TMDB_MAX_AGE_MS;
    if (meta.loadedAt > opts.nowMs || opts.nowMs - meta.loadedAt < keepFor) return useCached();
  }
  try { await loadTitles(platform, db, kind, sources.tmdb, opts); return 'loaded'; } catch (e) { fail(e); }
  return meta ? useCached() : 'none';
}
