import { expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSchema } from '../src/schema.js';
import { nodePlatform } from '../src/node/index.js';
import { openStaging, sweepStagingFiles, STAGING_BATCH } from '../src/guide-staging.js';

const P = nodePlatform();
const prog = (ch: string, startMs: number, title = 'T') => ({ epg_channel_id: ch, startMs, endMs: startMs + 1, title, description: '' });
const rows = (db: DatabaseSync, table: string) => (db.prepare(`select count(*) c from ${table}`).get() as { c: number }).c;
const dir = () => mkdtempSync(path.join(tmpdir(), 'staging-'));
const stagingFiles = (d: string) => readdirSync(d).filter((f) => f.startsWith('guide-staging-'));

test('adds are buffered and written in batches to a scratch file next to the data; flush writes the rest', () => {
  const db = new DatabaseSync(':memory:'); createSchema(db);
  const d = dir();
  const s = openStaging(db, P, d, 's1', 'g');
  expect(stagingFiles(d)).toHaveLength(1);
  for (let i = 0; i < STAGING_BATCH; i++) s.add(prog('a', i));
  expect(rows(db, s.table)).toBe(STAGING_BATCH);
  s.add(prog('a', STAGING_BATCH)); s.add(prog('a', STAGING_BATCH));   // a duplicate: kept here, dropped at commit
  expect(rows(db, s.table)).toBe(STAGING_BATCH);
  s.flush();
  expect(rows(db, s.table)).toBe(STAGING_BATCH + 2);
  expect(s.parsed).toBe(STAGING_BATCH + 2);
  s.discard();
});

test('two stagings on one connection are independent; discard detaches and deletes the file (twice is fine)', () => {
  const db = new DatabaseSync(':memory:'); createSchema(db);
  const d = dir();
  const a = openStaging(db, P, d, 's1', 'g'); const b = openStaging(db, P, d, 's2', 'g');
  a.add(prog('a', 1)); a.flush();
  expect(rows(db, b.table)).toBe(0);
  expect(a.table).not.toBe(b.table);
  a.discard(); a.discard(); b.discard();
  expect(stagingFiles(d)).toEqual([]);
  expect((db.prepare('pragma database_list').all() as { name: string }[]).map((r) => r.name)).toEqual(['main']);
});

test('a failed batch rolls back and leaves no transaction open on the connection', () => {
  const db = new DatabaseSync(':memory:'); createSchema(db);
  const s = openStaging(db, P, dir(), 's1', 'g');
  s.add({ ...prog('a', 1), title: null as unknown as string });
  expect(() => s.flush()).toThrow();
  expect(db.isTransaction).toBe(false);
  s.discard();
});

test('without a folder (the test-only replaceEpg path) a private scratch database is used', () => {
  const db = new DatabaseSync(':memory:'); createSchema(db);
  const s = openStaging(db, P, null, 's1', 'g');
  s.add(prog('a', 1)); s.flush();
  expect(rows(db, s.table)).toBe(1);
  s.discard();
});

test('sweepStagingFiles removes scratch files a crash left behind and nothing else', () => {
  const d = dir();
  for (const f of ['guide-staging-old.sqlite', 'guide-staging-old.sqlite-journal', 'sbtltv-data.sqlite', 'tmdb-titles.sqlite']) writeFileSync(path.join(d, f), 'x');
  expect(sweepStagingFiles(P, d)).toBe(2);
  expect(readdirSync(d).sort()).toEqual(['sbtltv-data.sqlite', 'tmdb-titles.sqlite']);
});
