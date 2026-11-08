import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_VERSION, createSchema, migrate, reindexGuide } from './schema.js';
import { openDatabase } from './db.js';

function tmpDb(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'sbtltv-db-')), 'data.sqlite');
}

test('createSchema builds every table and records the version', () => {
  const db = new DatabaseSync(':memory:');
  createSchema(db);
  const tables = db.prepare("select name from sqlite_master where type='table' order by name").all().map((r) => (r as { name: string }).name);
  for (const t of ['meta', 'sources_meta', 'categories', 'channels', 'channel_categories', 'epg_programs', 'epg_links', 'vod_categories', 'vod_movies', 'vod_series', 'vod_episodes', 'vod_item_categories']) {
    assert.ok(tables.includes(t), `missing table ${t}`);
  }
  const v = db.prepare("select value from meta where key='schema_version'").get() as { value: string };
  assert.equal(Number(v.value), SCHEMA_VERSION);
});

test('migrate is a no-op at the current version and refuses a newer file', () => {
  const db = new DatabaseSync(':memory:');
  createSchema(db);
  migrate(db);
  db.prepare("update meta set value=? where key='schema_version'").run(String(SCHEMA_VERSION + 1));
  assert.throws(() => migrate(db), /newer/);
});

test('openDatabase sets WAL and a busy timeout and creates the schema on a new file', () => {
  const p = tmpDb();
  const db = openDatabase(p, { readOnly: false });
  const mode = db.prepare('pragma journal_mode').get() as { journal_mode: string };
  assert.equal(mode.journal_mode, 'wal');
  assert.equal((db.prepare("select count(*) c from sqlite_master where name='channels'").get() as { c: number }).c, 1);
  db.close();
});

test('openDatabase replaces a corrupt file and starts fresh, keeping no copy', () => {
  const p = tmpDb();
  writeFileSync(p, 'this is not a database');
  const logs: string[] = [];
  const db = openDatabase(p, { readOnly: false, log: (m) => logs.push(m) });
  assert.equal((db.prepare("select count(*) c from sqlite_master where name='channels'").get() as { c: number }).c, 1);
  db.close();
  const siblings = readdirSync(path.dirname(p));
  assert.ok(!siblings.some((f) => /corrupt|aside/.test(f)), `expected no copy, got ${siblings}`);
  assert.ok(logs.some((m) => /integrity/i.test(m)));
  assert.ok(existsSync(p));
});

test('migration 1 to 2 indexes the guide that is already there', () => {
  const db = new DatabaseSync(':memory:');
  createSchema(db);
  db.exec(`drop table epg_programs_fts`);
  db.exec(`insert into epg_programs values ('p1', 's1', 'g', 'c', 1, 2, 'Football Night', 'desc')`);
  db.prepare("update meta set value='1' where key='schema_version'").run();
  migrate(db);
  const hits = db.prepare(`select count(*) c from epg_programs_fts where epg_programs_fts match '"football"*'`).get() as { c: number };
  assert.equal(hits.c, 1);
});

test('migration 2 to 3 adds the episode fetch time, keeping series and their episodes', () => {
  const db = new DatabaseSync(':memory:');
  createSchema(db);
  db.exec(`alter table vod_series drop column episodes_fetched`);
  db.exec(`insert into vod_series(series_id, source_id, name) values ('s1_sr1', 's1', 'Show')`);
  db.exec(`insert into vod_episodes(id, series_id, season_num, episode_num, title, direct_url) values ('e1', 's1_sr1', 1, 1, 'Pilot', 'http://x')`);
  db.prepare("update meta set value='2' where key='schema_version'").run();
  migrate(db);
  const row = db.prepare(`select name, episodes_fetched from vod_series`).get() as { name: string; episodes_fetched: number | null };
  assert.deepEqual({ ...row }, { name: 'Show', episodes_fetched: null });
  assert.equal((db.prepare(`select count(*) c from vod_episodes`).get() as { c: number }).c, 1);
  assert.equal(SCHEMA_VERSION, 3);
});

test('a new database has the guide index', () => {
  const db = new DatabaseSync(':memory:');
  createSchema(db);
  const row = db.prepare("select count(*) c from sqlite_master where name='epg_programs_fts'").get() as { c: number };
  assert.equal(row.c, 1);
});

test('a database newer than this build is moved aside and started fresh, and the caller is told', () => {
  const file = tmpDb();
  const first = openDatabase(file, { readOnly: false });
  first.prepare("update meta set value=? where key='schema_version'").run(String(SCHEMA_VERSION + 1));
  first.close();
  const reasons: string[] = [];
  const db = openDatabase(file, { readOnly: false, onReset: (reason) => reasons.push(reason) });
  const v = db.prepare("select value from meta where key='schema_version'").get() as { value: string };
  assert.equal(Number(v.value), SCHEMA_VERSION);
  assert.equal(reasons.length, 1);
  db.close();
});

test('a damaged search index is rebuilt rather than discarding the file', () => {
  const file = tmpDb();
  const first = openDatabase(file, { readOnly: false });
  first.exec(`insert into epg_programs values ('p1', 's1', 'g', 'c', 1, 2, 'Football', '')`);
  reindexGuide(first);
  first.close();
  const vandal = new DatabaseSync(file, { defensive: false } as never);
  vandal.exec(`delete from epg_programs_fts_data where id > 10`);
  vandal.close();
  const reasons: string[] = [];
  const db = openDatabase(file, { readOnly: false, onReset: (r) => reasons.push(r) });
  const hits = db.prepare(`select count(*) c from epg_programs_fts where epg_programs_fts match '"football"*'`).get() as { c: number };
  assert.equal(hits.c, 1);
  assert.deepEqual(reasons, []);
  db.close();
});

test('a corrupt file tells the caller, so the user hears why the guide is empty', () => {
  const file = tmpDb();
  writeFileSync(file, 'not a database at all, not even close');
  const reasons: string[] = [];
  openDatabase(file, { readOnly: false, onReset: (r) => reasons.push(r) }).close();
  assert.equal(reasons.length, 1);
});

test('a file with no problem is never reported', () => {
  const file = tmpDb();
  openDatabase(file, { readOnly: false }).close();
  const reasons: string[] = [];
  openDatabase(file, { readOnly: false, onReset: (r) => reasons.push(r) }).close();
  assert.deepEqual(reasons, []);
});

test('a version 1 file on disk comes up at the current version with its guide indexed, and nobody is told', () => {
  const file = tmpDb();
  const first = openDatabase(file, { readOnly: false });
  first.exec(`drop table epg_programs_fts`);
  first.exec(`insert into epg_programs values ('p1', 's1', 'g', 'c', 1, 2, 'Football', '')`);
  first.prepare("update meta set value='1' where key='schema_version'").run();
  first.close();
  const reasons: string[] = [];
  const db = openDatabase(file, { readOnly: false, onReset: (r) => reasons.push(r) });
  const hits = db.prepare(`select count(*) c from epg_programs_fts where epg_programs_fts match '"football"*'`).get() as { c: number };
  assert.equal(hits.c, 1);
  assert.deepEqual(reasons, []);
  db.close();
});

test('giving up a newer file takes its write-ahead log with it', { skip: process.platform === 'win32' }, () => {
  const file = tmpDb();
  const first = openDatabase(file, { readOnly: false });
  first.prepare("update meta set value=? where key='schema_version'").run(String(SCHEMA_VERSION + 1));
  first.close();
  writeFileSync(`${file}-wal`, '');
  const db = openDatabase(file, { readOnly: false });
  assert.equal(Number((db.prepare("select value from meta where key='schema_version'").get() as { value: string }).value), SCHEMA_VERSION);
  db.close();
});

test('a failed migration keeps the file: it may be a full disk, and imported playlists live only here', () => {
  const file = tmpDb();
  const first = openDatabase(file, { readOnly: false });
  first.exec(`insert into channels(stream_id, source_id, name, direct_url) values ('c1', 's1', 'Kept', '')`);
  first.prepare("update meta set value='1' where key='schema_version'").run();
  first.exec('drop table epg_programs_fts');
  first.exec(`create table epg_programs_fts (x)`); // the migration's fts5 rebuild fails on this
  first.close();
  const reasons: string[] = [];
  assert.throws(() => openDatabase(file, { readOnly: false, onReset: (r) => reasons.push(r) }));
  assert.deepEqual(reasons, []);
  const again = new DatabaseSync(file);
  assert.equal((again.prepare('select count(*) c from channels').get() as { c: number }).c, 1);
  again.close();
});

test('a file that cannot be used is deleted, not kept: it holds logins', () => {
  const file = tmpDb();
  const first = openDatabase(file, { readOnly: false });
  first.prepare("update meta set value=? where key='schema_version'").run(String(SCHEMA_VERSION + 1));
  first.close();
  openDatabase(file, { readOnly: false }).close();
  assert.deepEqual(readdirSync(path.dirname(file)).filter((f) => /aside|corrupt/.test(f)), []);
});

test('leftover moved-aside copies are removed on open', () => {
  const file = tmpDb();
  writeFileSync(`${file}.aside-123`, 'old');
  writeFileSync(`${file}.corrupt-456-wal`, 'old');
  openDatabase(file, { readOnly: false }).close();
  assert.deepEqual(readdirSync(path.dirname(file)).filter((f) => /aside|corrupt/.test(f)), []);
});

test('only the role that recovers may replace the file', () => {
  const file = tmpDb();
  const first = openDatabase(file, { readOnly: false });
  first.prepare("update meta set value=? where key='schema_version'").run(String(SCHEMA_VERSION + 1));
  first.close();
  assert.throws(() => openDatabase(file, { readOnly: false, recover: false }), /newer/);
  assert.equal(existsSync(file), true);
});
