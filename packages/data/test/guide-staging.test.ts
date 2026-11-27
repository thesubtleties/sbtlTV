import { expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createSchema } from '../src/schema.js';
import { openStaging, STAGING_BATCH } from '../src/guide-staging.js';

const prog = (ch: string, startMs: number, title = 'T') => ({ epg_channel_id: ch, startMs, endMs: startMs + 1, title, description: '' });
const staged = (db: DatabaseSync) => db.prepare('select id, title from temp.epg_staging order by rowid').all().map((r) => ({ ...(r as object) }));
const exists = (db: DatabaseSync) => (db.prepare("select count(*) c from temp.sqlite_master where name = 'epg_staging'").get() as { c: number }).c === 1;

test('adds are buffered and written in batches; flush writes the rest', () => {
  const db = new DatabaseSync(':memory:'); createSchema(db);
  const s = openStaging(db, 's1', 'g');
  for (let i = 0; i < STAGING_BATCH; i++) s.add(prog('a', i));
  expect(staged(db)).toHaveLength(STAGING_BATCH);
  s.add(prog('a', STAGING_BATCH));
  expect(staged(db)).toHaveLength(STAGING_BATCH);
  s.flush();
  expect(staged(db)).toHaveLength(STAGING_BATCH + 1);
  expect(s.parsed).toBe(STAGING_BATCH + 1);
});

test('first add wins for a duplicate id (as insert or ignore did); parsed still counts both', () => {
  const db = new DatabaseSync(':memory:'); createSchema(db);
  const s = openStaging(db, 's1', 'g');
  s.add(prog('a', 1, 'First')); s.add(prog('a', 1, 'Second')); s.add(prog('b', 1, 'Other'));
  s.flush();
  expect(staged(db)).toEqual([{ id: 's1::g::a::1', title: 'First' }, { id: 's1::g::b::1', title: 'Other' }]);
  expect(s.parsed).toBe(3);
});

test('reopen starts empty, and discard drops the table (twice is fine)', () => {
  const db = new DatabaseSync(':memory:'); createSchema(db);
  const a = openStaging(db, 's1', 'g'); a.add(prog('a', 1)); a.flush();
  const b = openStaging(db, 's2', 'g');
  expect(staged(db)).toEqual([]);
  b.discard(); b.discard();
  expect(exists(db)).toBe(false);
});

test('a written batch leaves no transaction open', () => {
  const db = new DatabaseSync(':memory:'); createSchema(db);
  const s = openStaging(db, 's1', 'g');
  for (let i = 0; i < STAGING_BATCH; i++) s.add(prog('a', i));
  expect(db.isTransaction).toBe(false);
});
