import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backupLabel, backupName, backupsToPrune, removeBackups, resetCacheIfMarked, CACHE_RESET_MARKER } from './setup-backups.js';

test('backup names sort by time and read as labels', () => {
  const name = backupName(new Date(2026, 9, 19, 22, 14));
  assert.equal(name, 'before-import-2026-10-19-221400.sbtltv');
  assert.equal(backupLabel(name), 'Before import, 19 Oct 22:14');
  assert.equal(backupLabel('notes.txt'), null);
});

test('only the newest three backups are kept, other files are never touched', () => {
  const names = ['before-import-2026-10-01-0900.sbtltv', 'before-import-2026-10-03-0900.sbtltv', 'readme.txt',
    'before-import-2026-10-02-0900.sbtltv', 'before-import-2026-10-04-0900.sbtltv'];
  assert.deepEqual(backupsToPrune(names), ['before-import-2026-10-01-0900.sbtltv']);
  assert.deepEqual(backupsToPrune(names.slice(0, 2)), []);
});

test('the cache is reset on start only when marked, and only the cache files go', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbtltv-reset-'));
  for (const f of ['sbtltv-data.sqlite', 'sbtltv-data.sqlite-wal', 'sbtltv-config.json']) fs.writeFileSync(path.join(dir, f), 'x');
  assert.equal(resetCacheIfMarked(dir), false);
  assert.ok(fs.existsSync(path.join(dir, 'sbtltv-data.sqlite')));
  fs.writeFileSync(path.join(dir, CACHE_RESET_MARKER), '');
  assert.equal(resetCacheIfMarked(dir), true);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['sbtltv-config.json']);
  fs.rmSync(dir, { recursive: true });
});

test('two backups in the same minute do not overwrite each other', () => {
  const a = backupName(new Date(2026, 9, 19, 12, 19, 5));
  const b = backupName(new Date(2026, 9, 19, 12, 19, 40));
  assert.notEqual(a, b);
  assert.equal(backupLabel(a), 'Before import, 19 Oct 12:19');
  assert.deepEqual(backupsToPrune([b, a, 'before-import-2026-10-19-1218.sbtltv', 'before-import-2026-10-19-1217.sbtltv']), ['before-import-2026-10-19-1217.sbtltv']);
});

// ---- review 8 (tests lens): kill tests ----
test('R8: a backup label is only ever a bare backup name (setup:openBackup uses it as its path guard)', () => {
  assert.equal(backupLabel('../../elsewhere/before-import-2026-10-19-1200.sbtltv'), null);
  assert.equal(backupLabel('before-import-2026-10-19-1200.sbtltv.bak'), null);
  assert.equal(backupLabel('x-before-import-2026-10-19-1200.sbtltv'), null);
});

test('R8: the cache reset takes the -shm file too', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbtltv-reset-'));
  for (const f of ['sbtltv-data.sqlite', 'sbtltv-data.sqlite-shm', CACHE_RESET_MARKER]) fs.writeFileSync(path.join(dir, f), 'x');
  resetCacheIfMarked(dir);
  assert.deepEqual(fs.readdirSync(dir), []);
  fs.rmSync(dir, { recursive: true });
});

test('a keyring switch removes the setup backups (another keyring cannot open them), nothing else', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbtltv-backups-'));
  for (const f of ['before-import-2026-10-19-121905.sbtltv', 'before-import-2026-10-19-1219.sbtltv', 'notes.txt']) fs.writeFileSync(path.join(dir, f), 'x');
  assert.equal(removeBackups(dir), 2);
  assert.deepEqual(fs.readdirSync(dir), ['notes.txt']);
  assert.equal(removeBackups(path.join(dir, 'missing')), 0);
  fs.rmSync(dir, { recursive: true });
});
