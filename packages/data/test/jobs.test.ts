import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vitest';
import { createSchema } from '../src/schema.js';
import { runJob } from '../src/jobs.js';
import type { StageContext } from '../src/sync-channels.js';
import { nodePlatform } from '../src/node/index.js';

test('a job for a source that is gone is skipped; an open series page still hears that it failed', async () => {
  const db = new DatabaseSync(':memory:'); createSchema(db);
  const logs: string[] = []; const progress: unknown[] = [];
  const ctx = { db, platform: nodePlatform(), tempDir: '/tmp', tmdbPath: '/tmp/tmdb-titles.sqlite', stagingDir: '/tmp', allowLanSources: false, log: (_c: string, m: string) => logs.push(m), progress: (p: unknown) => progress.push(p), changed: () => {} } satisfies StageContext;
  await runJob(ctx, [], { kind: 'episodes', sourceId: 'x', seriesId: '7' });
  expect(logs).toEqual(['Job episodes for unknown source x skipped']);
  expect(progress).toEqual([{ sourceId: 'x', stage: 'episodes', state: 'failed', seriesId: '7', message: 'This source is no longer set up' }]);
});
