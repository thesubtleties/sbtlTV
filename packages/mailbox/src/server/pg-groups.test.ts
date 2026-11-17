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
    await migrate(pool, 'key-1');
    return new PgGroupStore(pool);
  });
  describe('epoch', () => {
    it('a database recreated under a running relay gets a new id (else computers would wrongly end sync)', async () => {
      const pool = new pg.Pool({ connectionString: url, max: 2 });
      pools.push(pool);
      await pool.query('drop table if exists sync_rekeys, sync_boxes, sync_groups, sync_meta');
      await migrate(pool, 'key-1');
      const store = new PgGroupStore(pool);
      const first = await store.epoch();
      await pool.query('drop table if exists sync_rekeys, sync_boxes, sync_groups, sync_meta');
      await migrate(pool, 'key-1');
      expect(await store.epoch()).not.toBe(first);
    });
  });
  describe('migrate', () => {
    it('running again (every relay start) keeps the database id (lens 7)', async () => {
      const pool = new pg.Pool({ connectionString: url, max: 2 });
      pools.push(pool);
      await pool.query('drop table if exists sync_rekeys, sync_boxes, sync_groups, sync_meta');
      await migrate(pool, 'key-1');
      const store = new PgGroupStore(pool);
      const first = await store.epoch();
      await migrate(pool, 'key-1');
      expect(await store.epoch()).toBe(first);
    });
  });
  describe('storage key', () => {
    it('a different key (or none before) drops the data and changes the database id; the same key keeps both', async () => {
      const pool = new pg.Pool({ connectionString: url, max: 2 });
      pools.push(pool);
      await pool.query('drop table if exists sync_rekeys, sync_boxes, sync_groups, sync_meta');
      await migrate(pool, 'key-1');
      const store = new PgGroupStore(pool);
      const first = await store.epoch();
      await store.putBox('a'.repeat(32), Buffer.alloc(32, 1), 'b'.repeat(32), Buffer.from('x'), '2026-11-17');
      await migrate(pool, 'key-1');
      expect(await store.epoch()).toBe(first);
      expect(await store.group('a'.repeat(32))).not.toBeNull();
      await migrate(pool, 'key-2');
      expect(await store.epoch()).not.toBe(first);
      expect(await store.group('a'.repeat(32))).toBeNull();
    });
  });
} else {
  describe.skip('GroupStore contract: postgres (set MAILBOX_TEST_PG)', () => {});
}
