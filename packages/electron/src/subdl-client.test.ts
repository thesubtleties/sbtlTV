import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseSearch, parseUsage, errorKind, SubdlClient, SubdlError, type HttpGet } from './subdl-client.js';

const fx = (n: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(`../src/fixtures/subdl/${n}`, import.meta.url)), 'utf8'));
const ok = (body: unknown) => ({ status: 200, headers: {}, body: new TextEncoder().encode(JSON.stringify(body)) });

test('movie search: one result per unpacked file, page/file ids, release names, no url kept', () => {
  const movie = parseSearch(fx('search-movie.json'));
  assert.ok(movie.length > 0);
  for (const r of movie) {
    assert.match(r.nId, /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/);
    assert.ok(r.releaseName.length > 0);
    assert.equal(r.language, 'en');
  }
  assert.equal(JSON.stringify(movie).includes('api_key'), false);
  assert.equal(JSON.stringify(movie).includes('/subtitle/'), false);
});

test('episode search: the episode file out of each season pack, with fps when given', () => {
  const ep = parseSearch(fx('search-episode.json'));
  assert.ok(ep.length > 0);
  assert.ok(ep.every((r) => r.episode === 14));
  assert.ok(ep.some((r) => r.pack));
  assert.ok(ep.some((r) => r.fps === 23.976));
});

test('no results, junk and bad ids give nothing', () => {
  assert.deepEqual(parseSearch(fx('search-empty.json')), []);
  assert.deepEqual(parseSearch(null), []);
  assert.deepEqual(parseSearch({ subtitles: [null, 5, { subtitlePage: '/s/info/../x', unpack_files: [{ file_n_id: 'a', format: 'srt' }] }] }), []);
  assert.deepEqual(parseSearch({ subtitles: [{ subtitlePage: '/s/info/P1', unpack_files: [{ file_n_id: 'F1', format: 'exe' }, { file_n_id: 'F2', format: 'srt', size: 5_000_000 }] }] }), []);
  assert.equal(parseSearch({ subtitles: [{ subtitlePage: '/s/info/P1', release_name: 'R', language: 'BR_PT', unpack_files: [{ file_n_id: 'F1', format: 'srt' }] }] })[0].language, 'br_pt');
});

test('usage from /me', () => {
  const u = parseUsage(fx('me.json'))!;
  assert.equal(u.downloadsLimit, 50);
  assert.ok(u.downloadsLeft >= 0 && u.downloadsLeft <= 50);
  assert.equal(parseUsage({}), null);
});

test('error kinds', () => {
  assert.equal(errorKind(401, fx('error-auth.json'), {}), 'auth');
  assert.equal(errorKind(403, {}, {}), 'auth');
  assert.equal(errorKind(429, {}, {}), 'quota');
  assert.equal(errorKind(403, { error: { code: 'quota_exceeded' } }, {}), 'quota');
  assert.equal(errorKind(404, { status: false, error: 'subtitle_not_found' }, {}), 'not-found');
  assert.equal(errorKind(502, {}, {}), 'network');
  assert.equal(errorKind(200, {}, {}), null);
});

test('client: key only in the Authorization header, never in the URL', async () => {
  const seen: Array<{ url: string; headers: Record<string, string> }> = [];
  const http: HttpGet = async (url, headers) => { seen.push({ url, headers }); return ok(fx('search-movie.json')); };
  const results = await new SubdlClient(http, () => 'KEY123').search({ tmdbId: 693134, type: 'movie' }, 'en');
  assert.ok(results.length > 0);
  assert.equal(seen[0].url.includes('KEY123'), false);
  assert.equal(seen[0].headers.Authorization, 'Bearer KEY123');
  assert.match(seen[0].url, /^https:\/\/api\.subdl\.com\/api\/v2\/subtitles\/search\?/);
  for (const part of ['tmdb_id=693134', 'type=movie', 'unpack=1', 'languages=en']) assert.ok(seen[0].url.includes(part), part);
});

test('client: no key -> auth error without a request; 401 -> SubdlError auth; network error hides details', async () => {
  let calls = 0;
  const http: HttpGet = async () => { calls++; return { status: 401, headers: {}, body: new TextEncoder().encode('{}') }; };
  await assert.rejects(new SubdlClient(http, () => null).usage(), (e: unknown) => e instanceof SubdlError && e.kind === 'auth');
  assert.equal(calls, 0);
  await assert.rejects(new SubdlClient(http, () => 'k').usage(), (e: unknown) => e instanceof SubdlError && e.kind === 'auth');
  const failing: HttpGet = async () => { throw new Error('getaddrinfo ENOTFOUND https://api.subdl.com/x?api_key=SECRET'); };
  await assert.rejects(new SubdlClient(failing, () => 'k').usage(), (e: unknown) => e instanceof SubdlError && e.kind === 'network' && !e.message.includes('SECRET'));
});

test('client: episode search sends season and episode; download goes to dl.subdl.com by page/file', async () => {
  const urls: string[] = [];
  const http: HttpGet = async (url) => { urls.push(url); return ok({ subtitles: [] }); };
  const c = new SubdlClient(http, () => 'k');
  await c.search({ tmdbId: 1396, type: 'tv', season: 5, episode: 14 }, 'pt-br');
  assert.ok(urls[0].includes('season=5') && urls[0].includes('episode=14') && urls[0].includes('languages=br_pt'));
  await c.download('abc_1/XyZ9');
  assert.equal(urls[1], 'https://dl.subdl.com/subtitle/abc_1/XyZ9');
  await assert.rejects(c.download('../x'), (e: unknown) => e instanceof SubdlError && e.kind === 'bad-response');
  assert.equal(urls.length, 2);
});

test('client: download errors map to kinds (quota on the file host, 404 gone); a 200 that is not JSON is bad-response', async () => {
  const status = (s: number, body = '{}'): HttpGet => async () => ({ status: s, headers: {}, body: new TextEncoder().encode(body) });
  await assert.rejects(new SubdlClient(status(429), () => 'k').download('p/f'), (e: unknown) => e instanceof SubdlError && e.kind === 'quota');
  await assert.rejects(new SubdlClient(status(404, 'Not Found'), () => 'k').download('p/f'), (e: unknown) => e instanceof SubdlError && e.kind === 'not-found');
  await assert.rejects(new SubdlClient(status(200, '<html>'), () => 'k').search({ tmdbId: 1, type: 'movie' }, 'en'), (e: unknown) => e instanceof SubdlError && e.kind === 'bad-response');
});

test('client: the file size cap is passed to the transport', async () => {
  const caps: number[] = [];
  const http: HttpGet = async (_u, _h, max) => { caps.push(max); return ok({ subtitles: [] }); };
  const c = new SubdlClient(http, () => 'k');
  await c.search({ tmdbId: 1, type: 'movie' }, 'en');
  await c.download('p/f');
  assert.deepEqual(caps, [1024 * 1024, 2 * 1024 * 1024]);
});
