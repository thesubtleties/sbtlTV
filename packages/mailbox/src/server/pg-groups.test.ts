// packages/mailbox/src/server/pg-groups.test.ts
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { groupStoreContract } from './groups.contract.js';
import { PgGroupStore, migrate } from './pg-groups.js';

const url = process.env.MAILBOX_TEST_PG;
const pools: pg.Pool[] = [];
afterAll(async () => { await Promise.all(pools.map((p) => p.end())); });

if (url) {
  groupStoreContract('postgres', async () => {
    const pool = new pg.Pool({ connectionString: url, max: 2 });
    pools.push(pool);
    await pool.query('drop table if exists sync_rekeys, sync_boxes, sync_groups, sync_meta');
    await migrate(pool);
    return new PgGroupStore(pool);
  });
  describe('epoch', () => {
    it('a database recreated under a running relay gets a new id (else computers would wrongly end sync)', async () => {
      const pool = new pg.Pool({ connectionString: url, max: 2 });
      pools.push(pool);
      await pool.query('drop table if exists sync_rekeys, sync_boxes, sync_groups, sync_meta');
      await migrate(pool);
      const store = new PgGroupStore(pool);
      const first = await store.epoch();
      await pool.query('drop table if exists sync_rekeys, sync_boxes, sync_groups, sync_meta');
      await migrate(pool);
      expect(await store.epoch()).not.toBe(first);
    });
  });
} else {
  describe.skip('GroupStore contract: postgres (set MAILBOX_TEST_PG)', () => {});
}
