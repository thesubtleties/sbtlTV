import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_VERSION, createSchema, migrate } from './schema.js';
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

test('openDatabase moves a corrupt file aside and starts fresh', () => {
  const p = tmpDb();
  writeFileSync(p, 'this is not a database');
  const logs: string[] = [];
  const db = openDatabase(p, { readOnly: false, log: (m) => logs.push(m) });
  assert.equal((db.prepare("select count(*) c from sqlite_master where name='channels'").get() as { c: number }).c, 1);
  db.close();
  const siblings = readdirSync(path.dirname(p));
  assert.ok(siblings.some((f) => f.startsWith('data.sqlite.corrupt-')), `expected a corrupt-* file, got ${siblings}`);
  assert.ok(logs.some((m) => /corrupt/i.test(m)));
  assert.ok(existsSync(p));
});
