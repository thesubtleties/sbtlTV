// packages/mailbox/src/server/pg-groups.test.ts
import pg from 'pg';
import { afterAll, describe } from 'vitest';
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
} else {
  describe.skip('GroupStore contract: postgres (set MAILBOX_TEST_PG)', () => {});
}
