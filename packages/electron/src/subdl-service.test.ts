import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SubdlService } from './subdl-service.js';
import { SubtitleCache } from './subtitle-cache.js';
import { SubdlError, type SubdlResult } from './subdl-client.js';

const SRT = '1\n00:00:01,000 --> 00:00:02,000\nHello there.\n\n2\n00:00:05,000 --> 00:00:06,000\n[MUSIC]\n\n3\n00:50:00,000 --> 00:50:02,000\nLater.\n';
const res = (nId: string): SubdlResult => ({ nId, releaseName: nId, language: 'en', hi: false, ai: false, author: null, season: null, episode: null, pack: false, popularity: null, fps: null });
const title = { tmdbId: 7, type: 'movie' as const };

function harness(opts: { results?: SubdlResult[]; files?: Record<string, Uint8Array | Error>; current?: () => boolean } = {}) {
  const calls = { search: 0, download: [] as string[], added: [] as string[] };
  const cache = new SubtitleCache(fs.mkdtempSync(path.join(os.tmpdir(), 'svc-')));
  const svc = new SubdlService({
    client: {
      search: async () => { calls.search++; return opts.results ?? [res('p/a')]; },
      download: async (nId) => {
        calls.download.push(nId);
        const f = opts.files?.[nId] ?? new TextEncoder().encode(SRT);
        if (f instanceof Error) throw f;
        return f;
      },
      usage: async () => ({ downloadsLeft: 1, downloadsLimit: 50, searchesLeft: 10 }),
    },
    cache,
    addSubtitle: async (p) => {
      calls.added.push(p);
      return { id: 9, lang: 'eng', title: null, codec: 'subrip', isCc: false, external: true, externalFile: p, hearingImpaired: false };
    },
    isCurrent: opts.current ?? (() => true),
    log: () => {},
  });
  return { svc, calls, cache };
}
const req = (o: object = {}) => ({ generation: 1, title, nId: 'auto' as string, language: 'en', preferSdh: false, duration: 3600, ...o });

test('auto: search, download best, add; cues come from the file without sound cues', async () => {
  const { svc, calls } = harness();
  const r = await svc.load(req());
  assert.ok('trackId' in r && r.trackId === 9 && r.nId === 'p/a');
  assert.equal(calls.added.length, 1);
  assert.deepEqual(svc.cues(1, 2, 0, 1).map((c) => c.text), ['Hello there.']);
  assert.deepEqual(svc.cues(2, 2, 0, 1), []);  // another load's cues are not handed out
});

test('saved choice in the cache: no second download', async () => {
  const { svc, calls } = harness();
  await svc.load(req({ nId: 'p/a' }));
  await svc.load(req({ nId: 'p/a' }));
  assert.deepEqual(calls.download, ['p/a']);
});

test('evicted saved choice is downloaded again', async () => {
  const { svc, calls, cache } = harness();
  await svc.load(req({ nId: 'p/a' }));
  fs.rmSync(cache.find(title, 'p/a')!);
  const r = await svc.load(req({ nId: 'p/a' }));
  assert.ok('trackId' in r);
  assert.deepEqual(calls.download, ['p/a', 'p/a']);
});

test('bad first file, good second; at most two downloads per attempt', async () => {
  const html = new TextEncoder().encode('<html>no</html>');
  const a = harness({ results: [res('p/bad'), res('p/good')], files: { 'p/bad': html } });
  const r = await a.svc.load(req());
  assert.ok('nId' in r && r.nId === 'p/good');
  assert.deepEqual(a.calls.download, ['p/bad', 'p/good']);
  const b = harness({ results: [res('p/1'), res('p/2'), res('p/3')], files: { 'p/1': html, 'p/2': html } });
  assert.deepEqual(await b.svc.load(req()), { error: 'no-file' });
  assert.deepEqual(b.calls.download, ['p/1', 'p/2']);
});

test('quota stops; auth pauses until keyChanged', async () => {
  const q = harness({ files: { 'p/a': new SubdlError('quota') } });
  assert.deepEqual(await q.svc.load(req()), { error: 'quota' });
  const a = harness({ files: { 'p/a': new SubdlError('auth') } });
  assert.deepEqual(await a.svc.load(req()), { error: 'auth' });
  assert.deepEqual(await a.svc.load(req()), { error: 'auth' });
  assert.equal(a.calls.search, 1);
  a.svc.keyChanged();
  await a.svc.load(req());
  assert.equal(a.calls.search, 2);
});

test('stale generation: nothing is added', async () => {
  const { svc, calls } = harness({ current: () => false });
  assert.deepEqual(await svc.load(req()), { error: 'stale' });
  assert.equal(calls.added.length, 0);
});

test('no results', async () => {
  const { svc } = harness({ results: [] });
  assert.deepEqual(await svc.load(req()), { error: 'not-found' });
});

test('timing check runs on the file against the duration', async () => {
  const { svc } = harness();
  const r = await svc.load(req({ duration: 600 }));  // last line at 50 min on a 10 min video
  assert.ok('timing' in r && r.timing.cutMismatch === true);
});

// ---- Review (PR #146): paths the first suite does not reach ----

function custom(o: { search?: () => Promise<SubdlResult[]>; download?: (nId: string) => Promise<Uint8Array>; add?: (p: string) => Promise<import('./subtitle-mpv.js').SubtitleTrack | null>; current?: () => boolean; cache?: SubtitleCache }) {
  const downloads: string[] = [];
  const added: string[] = [];
  const cache = o.cache ?? new SubtitleCache(fs.mkdtempSync(path.join(os.tmpdir(), 'svc-')));
  const svc = new SubdlService({
    client: {
      search: o.search ?? (async () => [res('p/a')]),
      download: async (nId) => { downloads.push(nId); return o.download ? o.download(nId) : new TextEncoder().encode(SRT); },
      usage: async () => ({ downloadsLeft: 1, downloadsLimit: 50, searchesLeft: 10 }),
    },
    cache,
    addSubtitle: o.add ?? (async (p) => { added.push(p); return { id: 9, lang: null, title: null, codec: 'subrip', isCc: false, external: true, externalFile: p, hearingImpaired: false }; }),
    isCurrent: o.current ?? (() => true),
    log: () => {},
  });
  return { svc, downloads, added, cache };
}

test('stream changes while the file downloads: nothing is added, but the paid download is cached', async () => {
  let current = true;
  const h = custom({ download: async () => { current = false; return new TextEncoder().encode(SRT); }, current: () => current });
  assert.deepEqual(await h.svc.load(req({ nId: 'p/a' })), { error: 'stale' });
  assert.equal(h.added.length, 0);
  assert.ok(h.cache.find(title, 'p/a'), 'the file that cost a download is kept for the next try');
});

test('network failure on the first file: the second is not tried (it would fail and cost a download)', async () => {
  const h = custom({ search: async () => [res('p/1'), res('p/2')], download: async () => { throw new SubdlError('network'); } });
  assert.deepEqual(await h.svc.load(req()), { error: 'network' });
  assert.deepEqual(h.downloads, ['p/1']);
});

test('rejected key: a saved file already in the cache still loads, with no request', async () => {
  const h = custom({ download: async () => { throw new SubdlError('auth'); } });
  h.cache.write(title, 'p/saved', 'srt', SRT);
  await h.svc.load(req({ nId: 'p/new' }));               // marks the key as rejected
  const r = await h.svc.load(req({ nId: 'p/saved' }));
  assert.ok('trackId' in r && r.nId === 'p/saved');
  assert.deepEqual(h.downloads, ['p/new']);
});

test('mpv never lists the added file: no-file', async () => {
  const h = custom({ add: async () => null });
  assert.deepEqual(await h.svc.load(req()), { error: 'no-file' });
});

test('cues for Sync follow the delay and speed (video time -> file time)', async () => {
  const h = custom({});
  await h.svc.load(req({ nId: 'p/a' }));
  // "Later." is at 3000 s in the file; at speed 0.5 and delay 10 it shows at 1510 s of video
  assert.deepEqual(h.svc.cues(1, 1510, 10, 0.5, 5).map((c) => c.text), ['Later.']);
  assert.deepEqual(h.svc.cues(1, 3000, 10, 0.5, 5), []);
});

test('a file loaded from the cache is marked recently used: eviction takes an older one first', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-'));
  const cache = new SubtitleCache(dir, SRT.length * 2 + 10);
  const h = custom({ cache });
  const a = cache.write(title, 'p/a', 'srt', SRT);
  const b = cache.write(title, 'p/b', 'srt', SRT);
  fs.utimesSync(a, new Date(1000), new Date(1000));
  fs.utimesSync(b, new Date(2000), new Date(2000));
  await h.svc.load(req({ nId: 'p/a' }));                 // cache hit: touches a
  await h.svc.load(req({ nId: 'p/c' }));                 // download: writes c, evicts
  assert.ok(cache.find(title, 'p/a'), 'just used, kept');
  assert.equal(cache.find(title, 'p/b'), null);
});

test('a language SubDL does not list never downloads a file in another language (minor: auto locale sk/lt/ca/tl)', async () => {
  const h = custom({ search: async () => [res('p/en')] });   // unfiltered search: English only
  const r = await h.svc.load(req({ language: 'sk' }));
  assert.deepEqual(r, { error: 'not-found' });
  assert.deepEqual(h.downloads, []);
});
