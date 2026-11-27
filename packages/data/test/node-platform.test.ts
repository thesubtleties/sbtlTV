import { createServer, type Server } from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { nodePlatform } from '../src/node/index.js';

const p = nodePlatform();
let server: Server | null = null;
afterEach(() => { server?.close(); server = null; });
const serve = (handler: Parameters<typeof createServer>[1]) => new Promise<string>((res) => { server = createServer(handler).listen(0, '127.0.0.1', () => res(`http://127.0.0.1:${(server!.address() as { port: number }).port}`)); });

test('openDb gives a working database with the node:sqlite shape', () => {
  const db = p.openDb(path.join(mkdtempSync(path.join(tmpdir(), 'd-')), 'x.sqlite'), { readOnly: false, busyTimeoutMs: 5000 });
  db.exec('create table t (a text)');
  db.prepare('insert into t values (?)').run('hi');
  expect(db.prepare('select a from t where a = $a').get({ $a: 'hi' })).toEqual({ a: 'hi' });
  db.close();
});

test('download: writes the body and reports status and size', async () => {
  const base = await serve((_q, r) => r.end('hello'));
  const dest = path.join(mkdtempSync(path.join(tmpdir(), 'd-')), 'f.tmp');
  expect(await p.net.downloadToFile(`${base}/x`, dest, { maxBytes: 100, allowLan: true, label: 'EPG download' })).toEqual({ status: 200, bytes: 5 });
  expect(readFileSync(dest, 'utf8')).toBe('hello');
});

test('download: over the cap fails with the limit message and leaves no file', async () => {
  const base = await serve((_q, r) => r.end('x'.repeat(2000)));
  const dir = mkdtempSync(path.join(tmpdir(), 'd-'));
  await expect(p.net.downloadToFile(`${base}/x`, path.join(dir, 'f.tmp'), { maxBytes: 1000, allowLan: true, label: 'EPG download' })).rejects.toThrow('EPG download exceeds 0MB limit');
  expect(readdirSync(dir)).toEqual([]);
});

test('download: a connection dropped part-way leaves no file', async () => {
  const base = await serve((_q, r) => { r.writeHead(200, { 'content-length': '1000' }); r.write('partial'); setTimeout(() => r.destroy(), 20); });
  const dir = mkdtempSync(path.join(tmpdir(), 'd-'));
  await expect(p.net.downloadToFile(`${base}/x`, path.join(dir, 'f.tmp'), { maxBytes: 1e9, allowLan: true, label: 'EPG download' })).rejects.toThrow();
  expect(readdirSync(dir)).toEqual([]);
});

test('download: with LAN sources off, a LAN address is refused and nothing is written', async () => {
  // Loopback counts as LAN (core url-guard), so a local test server can't host an allowed first hop. The every-hop
  // check is today's get() moved unchanged; this pins that the guard runs and fails clean.
  const base = await serve((_q, r) => r.end('should not be fetched'));
  const dir = mkdtempSync(path.join(tmpdir(), 'd-'));
  await expect(p.net.downloadToFile(`${base}/x`, path.join(dir, 'f.tmp'), { maxBytes: 1e9, allowLan: false, label: 'EPG download' })).rejects.toThrow('local network access is disabled');
  expect(readdirSync(dir)).toEqual([]);
});

test('gunzip: inflates; over the cap fails and leaves no output', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'd-'));
  writeFileSync(path.join(dir, 'a.gz'), gzipSync('<tv></tv>'));
  await p.gunzip.gunzipFile(path.join(dir, 'a.gz'), path.join(dir, 'a.xml'), { maxBytes: 100, label: 'EPG decompression' });
  expect(readFileSync(path.join(dir, 'a.xml'), 'utf8')).toBe('<tv></tv>');
  writeFileSync(path.join(dir, 'b.gz'), gzipSync('y'.repeat(5000)));
  await expect(p.gunzip.gunzipFile(path.join(dir, 'b.gz'), path.join(dir, 'b.xml'), { maxBytes: 100, label: 'EPG decompression' })).rejects.toThrow('EPG decompression exceeds');
  expect(readdirSync(dir).sort()).toEqual(['a.gz', 'a.xml', 'b.gz']);
});

test('files: readHead, readText in chunks, remove of a missing file is fine', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'd-'));
  writeFileSync(path.join(dir, 't.txt'), 'é'.repeat(3000));
  expect(Array.from(p.files.readHead(path.join(dir, 't.txt'), 2))).toEqual([0xc3, 0xa9]);
  let text = ''; for await (const c of p.files.readText(path.join(dir, 't.txt'), 1024)) text += c;
  expect(text).toBe('é'.repeat(3000));
  expect(() => p.files.remove(path.join(dir, 'missing'))).not.toThrow();
});

test('files.removeAsync reports a failed delete instead of hiding it (the guide cleanup logs it)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'd-'));
  await expect(p.files.removeAsync(dir)).rejects.toThrow();   // a directory can't be unlinked
});
