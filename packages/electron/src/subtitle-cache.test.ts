import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SubtitleCache, titleKey } from './subtitle-cache.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'subcache-'));
const movie = { tmdbId: 1, type: 'movie' as const };

test('keys', () => {
  assert.equal(titleKey(movie), 'movie_1');
  assert.equal(titleKey({ tmdbId: 2, type: 'tv', season: 5, episode: 14 }), 'tv_2_s5e14');
});

test('write then find, page/file ids included; only own files are owned', () => {
  const c = new SubtitleCache(tmp());
  assert.equal(c.find(movie, 'pg/fl'), null);
  const p = c.write(movie, 'pg/fl', 'srt', 'hello');
  assert.equal(c.find(movie, 'pg/fl'), p);
  assert.equal(fs.readFileSync(p, 'utf8'), 'hello');
  assert.match(path.basename(p), /^[0-9a-f]{32}\.srt$/);   // a hash: ids never collide or leak into names
  assert.equal(c.owns(p), true);
  assert.equal(c.owns('/etc/passwd'), false);
  assert.equal(c.owns(path.join(p, '..', '..', '..', 'x.srt')), false);
});

test('bad ids, extensions and titles are refused', () => {
  const c = new SubtitleCache(tmp());
  assert.throws(() => c.write(movie, '../x', 'srt', 'a'));
  assert.throws(() => c.write(movie, 'a/b/c', 'srt', 'a'));
  assert.throws(() => c.write(movie, 'x', 'exe', 'a'));
  assert.throws(() => c.write({ tmdbId: -1, type: 'movie' }, 'x', 'srt', 'a'));
  assert.equal(c.find(movie, '../x'), null);
});

test('evict removes the oldest files past the cap; find then misses', () => {
  const c = new SubtitleCache(tmp(), 10);
  const old = c.write(movie, 'old', 'srt', '1234567');
  fs.utimesSync(old, new Date(1000), new Date(1000));
  c.write(movie, 'new', 'srt', '1234567');
  c.evict();
  assert.equal(c.find(movie, 'old'), null);
  assert.ok(c.find(movie, 'new'));
});

test('ids that used to map to the same name stay apart', () => {
  const c = new SubtitleCache(tmp());
  const a = c.write(movie, 'a__b/c', 'srt', 'one');
  const b = c.write(movie, 'a/b__c', 'srt', 'two');
  assert.notEqual(a, b);
  assert.equal(fs.readFileSync(c.find(movie, 'a__b/c')!, 'utf8'), 'one');
});

test('clear removes every cached subtitle; evict skips a file being written', () => {
  const dir = tmp();
  const c = new SubtitleCache(dir, 1);
  const p = c.write(movie, 'x', 'srt', 'hello');
  fs.writeFileSync(`${p}.tmp`, 'partial');
  c.evict();
  assert.ok(fs.existsSync(`${p}.tmp`), 'a .tmp file is someone else\'s write in progress');
  c.clear();
  assert.equal(c.find(movie, 'x'), null);
  assert.deepEqual(fs.existsSync(dir) ? fs.readdirSync(dir) : [], []);
});
