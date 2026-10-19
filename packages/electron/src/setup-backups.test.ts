import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backupLabel, backupName, backupsToPrune, resetCacheIfMarked, CACHE_RESET_MARKER } from './setup-backups.js';

test('backup names sort by time and read as labels', () => {
  const name = backupName(new Date(2026, 9, 19, 22, 14));
  assert.equal(name, 'before-import-2026-10-19-2214.sbtltv');
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
