/**
 * Sync groups in Postgres. A rebuildable cache: computers re-upload their box when it's missing,
 * so there are no backups. Dates are whole days. Nothing here knows an address.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { GROUP_IDLE_DAYS, MAX_COMPUTERS } from '../protocol/index.js';
import { dayMinus, sameHash, type GroupStore, type ListResult, type Moved } from './groups.js';

// Dates as 'YYYY-MM-DD' text, not JS Dates (pg's default would shift them by the local zone)
pg.types.setTypeParser(1082, (v: string) => v);

const SCHEMA_VERSION = 1;
const DDL = `
create table if not exists sync_meta (k text primary key, v text not null);
create table if not exists sync_groups (
  id text primary key, token_hash bytea not null, moved_on date, last_seen date not null, seq bigint not null default 0);
create table if not exists sync_boxes (
  group_id text not null references sync_groups(id) on delete cascade, device_id text not null,
  seq bigint not null, sealed bytea not null, primary key (group_id, device_id));
create table if not exists sync_rekeys (
  group_id text not null references sync_groups(id) on delete cascade, device_id text not null,
  sealed bytea not null, fetched boolean not null default false, primary key (group_id, device_id));
create index if not exists sync_groups_last_seen on sync_groups (last_seen);
`;

/**
 * The relay's pool. A connection that drops while idle (database restart, failover) makes the
 * pool emit 'error'; unhandled, that would end the process and every knock in memory with it.
 * The pool reconnects on its own; nothing is logged (no addresses anywhere).
 */
export function makePool(connectionString: string): pg.Pool {
  const pool = new pg.Pool({ connectionString, max: 5 });
  pool.on('error', () => {});
  return pool;
}

export async function migrate(pool: pg.Pool): Promise<void> {
  await pool.query(DDL);
  await pool.query(`insert into sync_meta (k, v) values ('schema', $1), ('epoch', $2) on conflict (k) do nothing`,
    [String(SCHEMA_VERSION), randomBytes(16).toString('hex')]);
}

async function tx<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export class PgGroupStore implements GroupStore {
  constructor(private pool: pg.Pool) {}

  async group(gid: string) {
    const r = await this.pool.query<{ token_hash: Buffer; moved_on: string | null }>('select token_hash, moved_on from sync_groups where id = $1', [gid]);
    return r.rows[0] ? { tokenHash: r.rows[0].token_hash, moved: r.rows[0].moved_on !== null } : null;
  }

  putBox(gid: string, tokenHash: Buffer, did: string, sealed: Buffer, today: string) {
    return tx(this.pool, async (c) => {
      await c.query('insert into sync_groups (id, token_hash, last_seen) values ($1, $2, $3) on conflict (id) do nothing', [gid, tokenHash, today]);
      const g = (await c.query<{ token_hash: Buffer; moved_on: string | null }>('select token_hash, moved_on from sync_groups where id = $1 for update', [gid])).rows[0];
      if (!sameHash(g.token_hash, tokenHash)) return 'denied' as const;
      if (g.moved_on) return 'moved' as const;
      const count = await c.query<{ others: string; mine: string }>(
        `select count(*) filter (where device_id <> $2) as others, count(*) filter (where device_id = $2) as mine from sync_boxes where group_id = $1`, [gid, did]);
      if (Number(count.rows[0].mine) === 0 && Number(count.rows[0].others) >= MAX_COMPUTERS) return 'full' as const;
      const seq = Number((await c.query<{ seq: string }>('update sync_groups set seq = seq + 1, last_seen = $2 where id = $1 returning seq', [gid, today])).rows[0].seq);
      await c.query(
        `insert into sync_boxes (group_id, device_id, seq, sealed) values ($1, $2, $3, $4)
         on conflict (group_id, device_id) do update set seq = excluded.seq, sealed = excluded.sealed`,
        [gid, did, seq, sealed],
      );
      return { seq };
    });
  }

  async list(gid: string, since: number, today: string): Promise<ListResult | Moved | null> {
    const g = (await this.pool.query<{ moved_on: string | null; seq: string }>(
      'update sync_groups set last_seen = $2 where id = $1 returning moved_on, seq', [gid, today])).rows[0];
    if (!g) return null;
    if (g.moved_on) {
      const w = await this.pool.query<{ n: string }>('select count(*) as n from sync_rekeys where group_id = $1 and not fetched', [gid]);
      return { moved: true, waiting: Number(w.rows[0].n) };
    }
    const rows = (await this.pool.query<{ device_id: string; seq: string; sealed: Buffer | null }>(
      'select device_id, seq, case when seq > $2 then sealed end as sealed from sync_boxes where group_id = $1', [gid, since])).rows;
    return {
      seq: Number(g.seq),
      computers: rows.map((r) => ({ id: r.device_id, seq: Number(r.seq) })),
      boxes: rows.filter((r) => r.sealed).map((r) => ({ id: r.device_id, seq: Number(r.seq), sealed: r.sealed! })),
    };
  }

  async deleteBox(gid: string, did: string) {
    await tx(this.pool, async (c) => {
      await c.query('delete from sync_boxes where group_id = $1 and device_id = $2', [gid, did]);
      await c.query('delete from sync_groups g where id = $1 and moved_on is null and not exists (select 1 from sync_boxes b where b.group_id = g.id)', [gid]);
    });
  }

  rekey(gid: string, keys: Map<string, Buffer>, today: string) {
    return tx(this.pool, async (c) => {
      const g = (await c.query<{ moved_on: string | null }>('select moved_on from sync_groups where id = $1 for update', [gid])).rows[0];
      if (!g) return null;
      if (g.moved_on) return 'moved' as const;
      await c.query('update sync_groups set moved_on = $2, last_seen = $2 where id = $1', [gid, today]);
      await c.query('delete from sync_boxes where group_id = $1', [gid]);
      for (const [did, sealed] of keys) await c.query('insert into sync_rekeys (group_id, device_id, sealed) values ($1, $2, $3)', [gid, did, sealed]);
      return 'ok' as const;
    });
  }

  async getRekey(gid: string, did: string, today: string) {
    const r = await this.pool.query<{ sealed: Buffer }>('update sync_rekeys set fetched = true where group_id = $1 and device_id = $2 returning sealed', [gid, did]);
    if (!r.rows[0]) return null;
    await this.pool.query('update sync_groups set last_seen = $2 where id = $1', [gid, today]);
    return r.rows[0].sealed;
  }

  async sweep(today: string) {
    const r = await this.pool.query(
      `delete from sync_groups g where last_seen < $1
         or (moved_on is not null and last_seen < $2
             and not exists (select 1 from sync_rekeys r where r.group_id = g.id and not r.fetched))`,
      [dayMinus(today, GROUP_IDLE_DAYS), today],
    );
    return r.rowCount ?? 0;
  }

  /**
   * Read every time (one tiny query): a database recreated under a running relay must show its new
   * id, or computers would take "group gone, same id" for "really deleted" and end sync.
   */
  async epoch() {
    return (await this.pool.query<{ v: string }>(`select v from sync_meta where k = 'epoch'`)).rows[0].v;
  }

  async close() { await this.pool.end(); }
}
