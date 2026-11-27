import { expect, test } from 'vitest';
import { createServer } from 'node:http';
import { mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { nodePlatform } from '../src/node/index.js';
import { openTitles, titlesMeta, isFresh, loadTitles, ensureTitles, titleSources, TMDB_MAX_AGE_MS, type LoadOptions, type TitleSource } from '../src/tmdb-store.js';
import type { Platform } from '../src/platform.js';

const P = nodePlatform();
const DAY = TMDB_MAX_AGE_MS;
const enrichedLines = (rows: { i: number; t: string; y?: number; p: number }[]) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

function serve(routes: Record<string, () => Buffer | number>): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const r = routes[req.url ?? ''];
      const body = r ? r() : 404;
      if (typeof body === 'number') { res.writeHead(body); res.end(); return; }
      res.writeHead(200); res.end(body);
    });
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => server.close() }));
  });
}
function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'tmdb-'));
  const tempDir = mkdtempSync(path.join(tmpdir(), 'tmdb-tmp-'));
  const logs: string[] = [];
  const opts: LoadOptions = { tempDir, allowLan: true, log: (m) => logs.push(m), nowMs: 10 * DAY };
  return { dir, tempDir, logs, opts, db: openTitles(P, path.join(dir, 'tmdb-titles.sqlite'), (m) => logs.push(m)) };
}
const rows = (db: ReturnType<typeof setup>['db'], table: string) => db.prepare(`select norm, id, year, popularity from ${table} order by rowid`).all().map((r) => ({ ...(r as object) }));

test('a load swaps in every usable line in file order, normalised, and records meta', async () => {
  const { db, opts } = setup();
  const gz = gzipSync(enrichedLines([{ i: 1, t: 'The Matrix', y: 1999, p: 80 }, { i: 2, t: '4K-EN - Heat (1995)', y: 1995, p: 50 }, { i: 3, t: '!!!', p: 1 }]) + 'not json\n');
  const { url, close } = await serve({ '/m.gz': () => gz });
  try {
    expect(await loadTitles(P, db, 'movie', { url: `${url}/m.gz`, origin: 'enriched' }, opts)).toBe(2);
    expect(rows(db, 'movie_titles')).toEqual([{ norm: 'the matrix', id: 1, year: 1999, popularity: 80 }, { norm: 'heat', id: 2, year: 1995, popularity: 50 }]);
    expect(titlesMeta(db, 'movie')).toEqual({ loadedAt: 10 * DAY, origin: 'enriched' });
    expect(db.prepare("select name from sqlite_master where type = 'index' and tbl_name = 'movie_titles'").all().map((r) => (r as { name: string }).name)).toEqual(['movie_titles_norm']);
  } finally { close(); }
});

test('the tmdb origin skips adult entries, reads original_title / original_name and has no year', async () => {
  const { db, opts } = setup();
  const lines = [{ id: 7, original_title: 'Heat', popularity: 3, adult: false }, { id: 8, original_title: 'X', popularity: 9, adult: true }];
  const tv = [{ id: 9, original_name: 'Lost', popularity: 4 }];
  const { url, close } = await serve({ '/m.gz': () => gzipSync(lines.map((l) => JSON.stringify(l)).join('\n')), '/t.gz': () => gzipSync(JSON.stringify(tv[0])) });
  try {
    await loadTitles(P, db, 'movie', { url: `${url}/m.gz`, origin: 'tmdb' }, opts);
    await loadTitles(P, db, 'series', { url: `${url}/t.gz`, origin: 'tmdb' }, opts);
    expect(rows(db, 'movie_titles')).toEqual([{ norm: 'heat', id: 7, year: null, popularity: 3 }]);
    expect(rows(db, 'series_titles')).toEqual([{ norm: 'lost', id: 9, year: null, popularity: 4 }]);
  } finally { close(); }
});

test('rows reach staging while the file is still being read (the export is never held whole)', async () => {
  const { db, opts } = setup();
  const big = enrichedLines(Array.from({ length: 60_000 }, (_, i) => ({ i, t: `Title ${i}`, y: 2000, p: i })));
  const { url, close } = await serve({ '/m.gz': () => gzipSync(big) });
  let stagedMidRead = -1; let chunks = 0;
  const spy: Platform = { ...P, files: { ...P.files, readText: async function* (p, size) {
    for await (const c of P.files.readText(p, size)) {
      if (++chunks === 3) stagedMidRead = (db.prepare('select count(*) c from movie_titles_next').get() as { c: number }).c;
      yield c;
    }
  } } };
  try {
    await loadTitles(spy, db, 'movie', { url: `${url}/m.gz`, origin: 'enriched' }, opts);
    expect(stagedMidRead).toBeGreaterThan(0);
    expect((db.prepare('select count(*) c from movie_titles').get() as { c: number }).c).toBe(60_000);
  } finally { close(); }
});

test('a failed load (not gzip, 404) keeps the old table and meta, and removes its temp files', async () => {
  const { db, opts, tempDir } = setup();
  const { url, close } = await serve({ '/ok.gz': () => gzipSync(enrichedLines([{ i: 1, t: 'Heat', y: 1995, p: 5 }])), '/bad.gz': () => Buffer.from('not gzip at all'), '/gone.gz': () => 404 });
  try {
    await loadTitles(P, db, 'movie', { url: `${url}/ok.gz`, origin: 'enriched' }, opts);
    for (const u of ['/bad.gz', '/gone.gz']) {
      await expect(loadTitles(P, db, 'movie', { url: `${url}${u}`, origin: 'enriched' }, { ...opts, nowMs: 20 * DAY })).rejects.toThrow();
    }
    expect(rows(db, 'movie_titles')).toEqual([{ norm: 'heat', id: 1, year: 1995, popularity: 5 }]);
    expect(titlesMeta(db, 'movie')?.loadedAt).toBe(10 * DAY);
    expect(readdirSync(tempDir)).toEqual([]);
  } finally { close(); }
});

test('empty export keeps the old table (zero usable rows is a failed load)', async () => {
  const { db, opts } = setup();
  const { url, close } = await serve({ '/ok.gz': () => gzipSync(enrichedLines([{ i: 1, t: 'Heat', p: 5 }])), '/empty.gz': () => gzipSync('garbage\n\n') });
  try {
    await loadTitles(P, db, 'movie', { url: `${url}/ok.gz`, origin: 'enriched' }, opts);
    await expect(loadTitles(P, db, 'movie', { url: `${url}/empty.gz`, origin: 'enriched' }, opts)).rejects.toThrow('no usable rows');
    expect(rows(db, 'movie_titles')).toHaveLength(1);
  } finally { close(); }
});

test('kinds are independent: loading series leaves movies alone', async () => {
  const { db, opts } = setup();
  const { url, close } = await serve({ '/m.gz': () => gzipSync(enrichedLines([{ i: 1, t: 'Heat', p: 5 }])), '/t.gz': () => gzipSync(enrichedLines([{ i: 2, t: 'Lost', p: 6 }])) });
  try {
    await loadTitles(P, db, 'movie', { url: `${url}/m.gz`, origin: 'enriched' }, opts);
    await loadTitles(P, db, 'series', { url: `${url}/t.gz`, origin: 'enriched' }, { ...opts, nowMs: 11 * DAY });
    expect(rows(db, 'movie_titles')).toHaveLength(1);
    expect(titlesMeta(db, 'movie')?.loadedAt).toBe(10 * DAY);
    expect(titlesMeta(db, 'series')?.loadedAt).toBe(11 * DAY);
  } finally { close(); }
});

test('freshness: under a day is fresh, a day or more is stale, a future loaded_at is stale', () => {
  expect(isFresh(10 * DAY, 10 * DAY + DAY - 1)).toBe(true);
  expect(isFresh(10 * DAY, 11 * DAY)).toBe(false);
  expect(isFresh(12 * DAY, 10 * DAY)).toBe(false);
});

test('ensureTitles: fresh skips the download; enriched failure uses a stale table; no table falls back to tmdb; both failing is none', async () => {
  const { db, opts, logs } = setup();
  let hits = 0;
  const { url, close } = await serve({ '/e.gz': () => { hits++; return gzipSync(enrichedLines([{ i: 1, t: 'Heat', p: 5 }])); }, '/t.gz': () => gzipSync(JSON.stringify({ id: 2, original_name: 'Lost', popularity: 1 })), '/down': () => 503 });
  const ok = { enriched: { url: `${url}/e.gz`, origin: 'enriched' as const }, tmdb: { url: `${url}/down`, origin: 'tmdb' as const } };
  try {
    expect(await ensureTitles(P, db, 'movie', ok, opts)).toBe('loaded');
    expect(await ensureTitles(P, db, 'movie', ok, { ...opts, nowMs: opts.nowMs + 1000 })).toBe('fresh');
    expect(hits).toBe(1);
    const down: { enriched: TitleSource; tmdb: TitleSource } = { enriched: { url: `${url}/down`, origin: 'enriched' }, tmdb: { url: `${url}/down`, origin: 'tmdb' } };
    expect(await ensureTitles(P, db, 'movie', down, { ...opts, nowMs: opts.nowMs + 2 * DAY })).toBe('stale');
    expect(logs.some((m) => m.startsWith('TMDB match: using cached movie titles from'))).toBe(true);
    expect(await ensureTitles(P, db, 'series', { ...down, tmdb: { url: `${url}/t.gz`, origin: 'tmdb' } }, opts)).toBe('loaded');
    expect(titlesMeta(db, 'series')?.origin).toBe('tmdb');
    const fresh = setup();
    expect(await ensureTitles(P, fresh.db, 'movie', down, fresh.opts)).toBe('none');
  } finally { close(); }
});

test('damaged file is rebuilt', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tmdb-'));
  const f = path.join(dir, 'tmdb-titles.sqlite');
  writeFileSync(f, 'this is not a database, just text that is long enough to have a header'.repeat(20));
  const logs: string[] = [];
  const db = openTitles(P, f, (m) => logs.push(m));
  expect(titlesMeta(db, 'movie')).toBeNull();
  expect(logs.some((m) => m.includes('rebuilt'))).toBe(true);
});

test('titleSources: enriched cache repo files, and the tmdb export for yesterday', () => {
  const now = new Date(2026, 10, 26, 12).getTime();   // local noon: "yesterday" is the local date, as before
  expect(titleSources('movie', now).enriched.url).toBe('https://raw.githubusercontent.com/thesubtleties/sbtlTV-tmdb-cache/main/data/tmdb-movies-enriched.ndjson.gz');
  expect(titleSources('series', now).enriched.url).toBe('https://raw.githubusercontent.com/thesubtleties/sbtlTV-tmdb-cache/main/data/tmdb-tvs-enriched.ndjson.gz');
  expect(titleSources('movie', now).tmdb.url).toBe('https://files.tmdb.org/p/exports/movie_ids_11_25_2026.json.gz');
  expect(titleSources('series', now).tmdb.url).toBe('https://files.tmdb.org/p/exports/tv_series_ids_11_25_2026.json.gz');
});

test('a daily reload gives the old table space back (the file does not keep growing)', async () => {
  const { db, opts, dir } = setup();
  const big = gzipSync(enrichedLines(Array.from({ length: 40_000 }, (_, i) => ({ i, t: `Some Long Movie Title Number ${i}`, y: 2000, p: i }))));
  const { url, close } = await serve({ '/m.gz': () => big });
  const size = () => statSync(path.join(dir, 'tmdb-titles.sqlite')).size;
  try {
    await loadTitles(P, db, 'movie', { url: `${url}/m.gz`, origin: 'enriched' }, opts);
    const first = size();
    await loadTitles(P, db, 'movie', { url: `${url}/m.gz`, origin: 'enriched' }, { ...opts, nowMs: opts.nowMs + DAY });
    expect(size()).toBeLessThan(first * 1.2);
  } finally { close(); }
});

test('a table from TMDB\'s own export (no years) is not fresh: the enriched export is tried again next time', async () => {
  const { db, opts } = setup();
  let enrichedUp = false;
  const { url, close } = await serve({
    '/e.gz': () => (enrichedUp ? gzipSync(enrichedLines([{ i: 1, t: 'Heat', y: 1995, p: 5 }])) : 503),
    '/t.gz': () => gzipSync(JSON.stringify({ id: 2, original_title: 'Heat', popularity: 1 })),
  });
  const sources = { enriched: { url: `${url}/e.gz`, origin: 'enriched' as const }, tmdb: { url: `${url}/t.gz`, origin: 'tmdb' as const } };
  try {
    expect(await ensureTitles(P, db, 'movie', sources, opts)).toBe('loaded');
    expect(titlesMeta(db, 'movie')?.origin).toBe('tmdb');
    enrichedUp = true;
    expect(await ensureTitles(P, db, 'movie', sources, { ...opts, nowMs: opts.nowMs + 1000 })).toBe('loaded');
    expect(titlesMeta(db, 'movie')?.origin).toBe('enriched');
  } finally { close(); }
});

test('the stale-table rule: a table with years is kept up to 7 days rather than switching to the year-less export', async () => {
  const { db, opts } = setup();
  let tmdbHits = 0;
  const { url, close } = await serve({
    '/e.gz': () => gzipSync(enrichedLines([{ i: 1, t: 'Heat', y: 1995, p: 5 }])),
    '/t.gz': () => { tmdbHits++; return gzipSync(JSON.stringify({ id: 2, original_title: 'Heat', popularity: 1 })); },
    '/down': () => 503,
  });
  const up = { enriched: { url: `${url}/e.gz`, origin: 'enriched' as const }, tmdb: { url: `${url}/t.gz`, origin: 'tmdb' as const } };
  const githubDown = { ...up, enriched: { url: `${url}/down`, origin: 'enriched' as const } };
  try {
    await ensureTitles(P, db, 'movie', up, opts);
    expect(await ensureTitles(P, db, 'movie', githubDown, { ...opts, nowMs: opts.nowMs + 6 * DAY })).toBe('stale');
    expect(tmdbHits).toBe(0);
    expect(titlesMeta(db, 'movie')?.origin).toBe('enriched');
    // past 7 days the year-less export is the last resort (it should never come to this)
    expect(await ensureTitles(P, db, 'movie', githubDown, { ...opts, nowMs: opts.nowMs + 8 * DAY })).toBe('loaded');
    expect(titlesMeta(db, 'movie')?.origin).toBe('tmdb');
    // a year-less table under a day old is used as is while GitHub stays down (no re-download of TMDB's export)
    expect(await ensureTitles(P, db, 'movie', githubDown, { ...opts, nowMs: opts.nowMs + 8 * DAY + 1000 })).toBe('stale');
    expect(tmdbHits).toBe(1);
    // and once GitHub is back, the enriched table returns
    expect(await ensureTitles(P, db, 'movie', up, { ...opts, nowMs: opts.nowMs + 8 * DAY + 2000 })).toBe('loaded');
    expect(titlesMeta(db, 'movie')?.origin).toBe('enriched');
  } finally { close(); }
});

test('a line with no end (a broken or hostile export) fails the load instead of growing without bound', async () => {
  const { db, opts } = setup();
  const { url, close } = await serve({ '/ok.gz': () => gzipSync(enrichedLines([{ i: 1, t: 'Heat', p: 5 }])), '/long.gz': () => gzipSync('x'.repeat(2_000_000)) });
  try {
    await loadTitles(P, db, 'movie', { url: `${url}/ok.gz`, origin: 'enriched' }, opts);
    await expect(loadTitles(P, db, 'movie', { url: `${url}/long.gz`, origin: 'enriched' }, opts)).rejects.toThrow('line longer than');
    expect(rows(db, 'movie_titles')).toHaveLength(1);
  } finally { close(); }
});

test('a title line too long to be real is skipped (no slow normalising of junk)', async () => {
  const { db, opts } = setup();
  const junk = JSON.stringify({ i: 2, t: ' '.repeat(10_000) + 'x', p: 1 });
  const { url, close } = await serve({ '/m.gz': () => gzipSync(enrichedLines([{ i: 1, t: 'Heat', p: 5 }]) + junk + '\n') });
  try {
    expect(await loadTitles(P, db, 'movie', { url: `${url}/m.gz`, origin: 'enriched' }, opts)).toBe(1);
  } finally { close(); }
});

test('the unpacked export is deleted before the swap (lower disk peak), and a failed load gives its space back', async () => {
  const { db, opts, tempDir, dir } = setup();
  const lines = enrichedLines(Array.from({ length: 40_000 }, (_, i) => ({ i, t: `Some Long Movie Title Number ${i}`, y: 2000, p: i })));
  const { url, close } = await serve({ '/m.gz': () => gzipSync(lines), '/bad.gz': () => gzipSync(lines + 'x'.repeat(2_000_000)) });
  let tempAtSwap = -1;
  const origExec = db.exec.bind(db);
  db.exec = (sql: string) => { if (sql.startsWith('alter table')) tempAtSwap = readdirSync(tempDir).length; origExec(sql); };
  const size = () => statSync(path.join(dir, 'tmdb-titles.sqlite')).size;
  try {
    await loadTitles(P, db, 'movie', { url: `${url}/m.gz`, origin: 'enriched' }, opts);
    expect(tempAtSwap).toBe(0);
    const good = size();
    await expect(loadTitles(P, db, 'movie', { url: `${url}/bad.gz`, origin: 'enriched' }, opts)).rejects.toThrow();
    expect(size()).toBeLessThan(good * 1.2);
  } finally { close(); }
});
