/**
 * Sync groups in Postgres. A rebuildable cache: computers re-upload their box when it's missing,
 * so there are no backups. Dates are whole days. Nothing here knows an address.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { BOX_PAD, GROUP_IDLE_DAYS, MAX_COMPUTERS } from '../protocol/index.js';
import { createHash } from 'node:crypto';
import { dayMinus, sameHash, type GroupStore, type ListResult, type Moved, type RekeyEntry } from './groups.js';

const entry = (e: RekeyEntry) => (Buffer.isBuffer(e) ? { sealed: e, ackHash: null } : e);

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
alter table sync_rekeys add column if not exists ack_hash bytea;
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

/**
 * `keyId` = the id of the relay's storage key (at-rest.ts). Data stored under another key (or none,
 * before it existed) can't be opened: it's dropped and the epoch changes, which computers read as
 * "the relay lost its data" and put their boxes back.
 */
export async function migrate(pool: pg.Pool, keyId: string): Promise<void> {
  await pool.query(DDL);
  await pool.query(`insert into sync_meta (k, v) values ('schema', $1), ('epoch', $2) on conflict (k) do nothing`,
    [String(SCHEMA_VERSION), randomBytes(16).toString('hex')]);
  await tx(pool, async (c) => {
    const r = await c.query<{ v: string }>(`select v from sync_meta where k = 'key' for update`);
    if (r.rows[0]?.v === keyId) return;
    await c.query('truncate sync_groups cascade');
    await c.query(`update sync_meta set v = $1 where k = 'epoch'`, [randomBytes(16).toString('hex')]);
    await c.query(`insert into sync_meta (k, v) values ('key', $1) on conflict (k) do update set v = excluded.v`, [keyId]);
  });
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

  putBox(gid: string, tokenHash: Buffer, did: string, sealed: Buffer, today: string, onlyReplace = false) {
    return tx(this.pool, async (c) => {
      if (onlyReplace) {
        const old = (await c.query<{ n: number }>('select octet_length(sealed) as n from sync_boxes where group_id = $1 and device_id = $2', [gid, did])).rows[0];
        if (!old || sealed.length > Number(old.n) + BOX_PAD) return 'busy' as const;
      }
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
    // last_seen is written once a day at most: no timestamped row version (and WAL record) per pull
    await this.pool.query('update sync_groups set last_seen = $2 where id = $1 and last_seen < $2', [gid, today]);
    const g = (await this.pool.query<{ moved_on: string | null; seq: string }>('select moved_on, seq from sync_groups where id = $1', [gid])).rows[0];
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
      // Locked like putBox: a first upload racing the last leave can't land in a group about to be deleted
      await c.query('select 1 from sync_groups where id = $1 for update', [gid]);
      await c.query('delete from sync_boxes where group_id = $1 and device_id = $2', [gid, did]);
      await c.query('delete from sync_groups g where id = $1 and moved_on is null and not exists (select 1 from sync_boxes b where b.group_id = g.id)', [gid]);
    });
  }

  rekey(gid: string, keys: Map<string, RekeyEntry>, today: string) {
    return tx(this.pool, async (c) => {
      const g = (await c.query<{ moved_on: string | null }>('select moved_on from sync_groups where id = $1 for update', [gid])).rows[0];
      if (!g) return null;
      if (g.moved_on) return 'moved' as const;
      await c.query('update sync_groups set moved_on = $2, last_seen = $2 where id = $1', [gid, today]);
      await c.query('delete from sync_boxes where group_id = $1', [gid]);
      for (const [did, e] of keys) { const x = entry(e); await c.query('insert into sync_rekeys (group_id, device_id, sealed, ack_hash) values ($1, $2, $3, $4)', [gid, did, x.sealed, x.ackHash]); }
      return 'ok' as const;
    });
  }

  createRetired(gid: string, tokenHash: Buffer, keys: Map<string, RekeyEntry>, today: string) {
    return tx(this.pool, async (c) => {
      const made = await c.query('insert into sync_groups (id, token_hash, moved_on, last_seen) values ($1, $2, $3, $3) on conflict (id) do nothing', [gid, tokenHash, today]);
      if (made.rowCount === 0) return 'exists' as const;
      for (const [did, e] of keys) { const x = entry(e); await c.query('insert into sync_rekeys (group_id, device_id, sealed, ack_hash) values ($1, $2, $3, $4)', [gid, did, x.sealed, x.ackHash]); }
      return 'ok' as const;
    });
  }

  async getRekey(gid: string, did: string, today: string) {
    const r = await this.pool.query<{ sealed: Buffer }>('select sealed from sync_rekeys where group_id = $1 and device_id = $2', [gid, did]);
    if (!r.rows[0]) return null;
    await this.pool.query('update sync_groups set last_seen = $2 where id = $1 and last_seen < $2', [gid, today]);
    return r.rows[0].sealed;
  }

  async ackRekey(gid: string, did: string, proof: Buffer, today: string) {
    const r = (await this.pool.query<{ ack_hash: Buffer | null }>('select ack_hash from sync_rekeys where group_id = $1 and device_id = $2', [gid, did])).rows[0];
    if (!r) return null;
    if (!r.ack_hash || !sameHash(r.ack_hash, createHash('sha256').update(proof).digest())) return 'bad' as const;
    await this.pool.query('update sync_rekeys set fetched = true where group_id = $1 and device_id = $2', [gid, did]);
    await this.pool.query('update sync_groups set last_seen = $2 where id = $1 and last_seen < $2', [gid, today]);
    return 'ok' as const;
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

  private size = { at: -Infinity, bytes: 0 };
  /** The database's size, read at most every 30 s (it only needs to stop a disk from filling) */
  async sizeBytes() {
    const now = Date.now();
    if (now - this.size.at > 30_000) {
      const r = await this.pool.query<{ n: string }>('select pg_database_size(current_database()) as n');
      this.size = { at: now, bytes: Number(r.rows[0].n) };
    }
    return this.size.bytes;
  }

  async close() { await this.pool.end(); }
}
