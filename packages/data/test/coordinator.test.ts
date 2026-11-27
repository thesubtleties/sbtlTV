import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vitest';
import type { DataSettings, Source } from '@sbtltv/core';
import { createSchema } from '../src/schema.js';
import { deletedSourceIds, dueJobs, stageOf, workerStoppedProgress } from '../src/coordinator.js';

const src = (id: string): Source => ({ id, name: `n${id}`, type: 'xtream', url: 'http://p.example', username: 'u', password: 'p', enabled: true } as Source);
const settings: DataSettings = { epgRefreshHours: 6, vodRefreshHours: 24, allowLanSources: false, debugLoggingEnabled: false };

test('stages and the stopped-worker progress match the jobs that report them', () => {
  expect(stageOf({ kind: 'channels', sourceId: 's' })).toBe('channels');
  expect(stageOf({ kind: 'deleteSource', sourceId: 's' })).toBeNull();
  expect(workerStoppedProgress({ kind: 'episodes', sourceId: 's', seriesId: '9' })).toEqual({ sourceId: 's', stage: 'episodes', state: 'failed', message: 'sync worker stopped unexpectedly; retrying', seriesId: '9' });
  expect(workerStoppedProgress({ kind: 'clearAll' } as never)).toBeNull();
});

test('a never-synced source is due for channels and VOD, with the usual log lines', () => {
  const db = new DatabaseSync(':memory:'); createSchema(db);
  const due = dueJobs(db, [src('s1')], settings, Date.now());
  expect(due.map((d) => d.job)).toEqual([{ kind: 'channels', sourceId: 's1' }, { kind: 'vod', sourceId: 's1' }]);
  expect(due.map((d) => d.message)).toEqual(['Source s1 is stale, syncing...', 'Source s1 is stale, syncing VOD...']);
});

test('rows of a source that is no longer set up are found; an empty source list removes nothing', () => {
  const db = new DatabaseSync(':memory:'); createSchema(db);
  db.prepare(`insert into sources_meta (source_id) values (?)`).run('gone');
  expect(deletedSourceIds(db, [src('s1')])).toEqual(['gone']);
  expect(deletedSourceIds(db, [])).toEqual([]);
});
