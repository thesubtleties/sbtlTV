/**
 * Sync groups: one sealed box per computer, addressed by a group id only the computers can derive.
 * Postgres in production (pg-groups.ts); this in-memory twin runs the same contract in tests and
 * when the relay runs without a database (local development). Dates are whole days on purpose:
 * the relay learns at most which day a group checked in.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { BOX_PAD, GROUP_IDLE_DAYS, MAX_COMPUTERS } from '../protocol/index.js';

export interface BoxRow { id: string; seq: number; sealed: Buffer }
/** A remaining computer's new key after a move: sealed for it, with the hash of its pick-up proof (null: no proof possible) */
export type RekeyEntry = Buffer | { sealed: Buffer; ackHash: Buffer | null };
const entry = (e: RekeyEntry) => (Buffer.isBuffer(e) ? { sealed: e, ackHash: null } : e);
export type ListResult = { seq: number; computers: { id: string; seq: number }[]; boxes: BoxRow[] };
/** A group re-keyed after a removal: how many remaining computers haven't fetched their new key */
export type Moved = { moved: true; waiting: number };

export interface GroupStore {
  /** null = no such group */
  group(gid: string): Promise<{ tokenHash: Buffer; moved: boolean } | null>;
  /**
   * Creates the group (with this token hash) when it doesn't exist. onlyReplace (the database is
   * over its size cap): only a computer replacing its own box, at most one BOX_PAD step bigger,
   * gets through; anything new or grown more is 'busy'.
   */
  putBox(gid: string, tokenHash: Buffer, did: string, sealed: Buffer, today: string, onlyReplace?: boolean): Promise<{ seq: number } | 'moved' | 'full' | 'denied' | 'busy'>;
  /** Boxes changed after `since`, and every computer's id + seq. Refreshes last_seen. */
  list(gid: string, since: number, today: string): Promise<ListResult | Moved | null>;
  /** The group goes with its last box. */
  deleteBox(gid: string, did: string): Promise<void>;
  rekey(gid: string, keys: Map<string, RekeyEntry>, today: string): Promise<'ok' | 'moved' | null>;
  /**
   * A group that doesn't exist, created already retired (moved, with each computer's sealed new
   * key): the remover restoring its marker after the relay lost its data, before anyone rebuilds it.
   * 'exists' = the group is there (use rekey, with its token checked).
   */
  createRetired(gid: string, tokenHash: Buffer, keys: Map<string, RekeyEntry>, today: string): Promise<'ok' | 'exists'>;
  /** This computer's new key after a move (read-only; refreshes last_seen). */
  getRekey(gid: string, did: string, today: string): Promise<Buffer | null>;
  /** The computer proves it opened its new key: only then does it count as picked up. null = no such key. */
  ackRekey(gid: string, did: string, proof: Buffer, today: string): Promise<'ok' | 'bad' | null>;
  /**
   * Deletes groups nobody checked in with for GROUP_IDLE_DAYS, and moved groups once every key
   * was fetched and a day has passed since the last check-in (for a lost reply). Returns how many.
   */
  sweep(today: string): Promise<number>;
  /** This database's id: different only after the data was lost and started again. */
  epoch(): Promise<string>;
  /** About how much the stored data takes (for the size cap) */
  sizeBytes(): Promise<number>;
  close(): Promise<void>;
}

export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export function dayMinus(today: string, days: number): string {
  return utcDay(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000);
}
export const sameHash = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

interface Group {
  tokenHash: Buffer; movedOn: string | null; lastSeen: string; seq: number;
  boxes: Map<string, BoxRow>; rekeys: Map<string, { sealed: Buffer; ackHash: Buffer | null; fetched: boolean }>;
}

export class MemoryGroupStore implements GroupStore {
  private groups = new Map<string, Group>();
  private id = randomBytes(16).toString('hex');

  async group(gid: string) {
    const g = this.groups.get(gid);
    return g ? { tokenHash: g.tokenHash, moved: g.movedOn !== null } : null;
  }

  async putBox(gid: string, tokenHash: Buffer, did: string, sealed: Buffer, today: string, onlyReplace = false) {
    let g = this.groups.get(gid);
    // The token first: without it nothing about the group's boxes shows (not even whether one exists)
    if (g && !sameHash(g.tokenHash, tokenHash)) return 'denied' as const;
    const old = g?.boxes.get(did);
    if (onlyReplace && (!old || sealed.length > old.sealed.length + BOX_PAD)) return 'busy' as const;
    if (!g) { g = { tokenHash, movedOn: null, lastSeen: today, seq: 0, boxes: new Map(), rekeys: new Map() }; this.groups.set(gid, g); }
    if (!sameHash(g.tokenHash, tokenHash)) return 'denied' as const;
    if (g.movedOn) return 'moved' as const;
    if (!g.boxes.has(did) && g.boxes.size >= MAX_COMPUTERS) return 'full' as const;
    g.seq += 1; g.lastSeen = today;
    g.boxes.set(did, { id: did, seq: g.seq, sealed: Buffer.from(sealed) });
    return { seq: g.seq };
  }

  async list(gid: string, since: number, today: string): Promise<ListResult | Moved | null> {
    const g = this.groups.get(gid);
    if (!g) return null;
    g.lastSeen = today;
    if (g.movedOn) return { moved: true, waiting: [...g.rekeys.values()].filter((r) => !r.fetched).length };
    const all = [...g.boxes.values()];
    return { seq: g.seq, computers: all.map(({ id, seq }) => ({ id, seq })), boxes: all.filter((b) => b.seq > since) };
  }

  async deleteBox(gid: string, did: string) {
    const g = this.groups.get(gid);
    if (!g) return;
    g.boxes.delete(did);
    if (g.boxes.size === 0 && !g.movedOn) this.groups.delete(gid);
  }

  async rekey(gid: string, keys: Map<string, RekeyEntry>, today: string) {
    const g = this.groups.get(gid);
    if (!g) return null;
    if (g.movedOn) return 'moved' as const;
    g.movedOn = today; g.lastSeen = today; g.boxes.clear();
    g.rekeys = new Map([...keys].map(([did, e]) => { const x = entry(e); return [did, { sealed: Buffer.from(x.sealed), ackHash: x.ackHash, fetched: false }]; }));
    return 'ok' as const;
  }

  async createRetired(gid: string, tokenHash: Buffer, keys: Map<string, RekeyEntry>, today: string) {
    if (this.groups.has(gid)) return 'exists' as const;
    this.groups.set(gid, {
      tokenHash, movedOn: today, lastSeen: today, seq: 0, boxes: new Map(),
      rekeys: new Map([...keys].map(([did, e]) => { const x = entry(e); return [did, { sealed: Buffer.from(x.sealed), ackHash: x.ackHash, fetched: false }]; })),
    });
    return 'ok' as const;
  }

  async getRekey(gid: string, did: string, today: string) {
    const g = this.groups.get(gid);
    const r = g?.rekeys.get(did);
    if (!g || !r) return null;
    g.lastSeen = today;
    return r.sealed;
  }

  async ackRekey(gid: string, did: string, proof: Buffer, today: string) {
    const g = this.groups.get(gid);
    const r = g?.rekeys.get(did);
    if (!g || !r) return null;
    if (!r.ackHash || !sameHash(r.ackHash, createHash('sha256').update(proof).digest())) return 'bad' as const;
    r.fetched = true; g.lastSeen = today;
    return 'ok' as const;
  }

  async sweep(today: string) {
    const idle = dayMinus(today, GROUP_IDLE_DAYS);
    let n = 0;
    for (const [gid, g] of this.groups) {
      const caughtUp = g.movedOn !== null && g.lastSeen < today && [...g.rekeys.values()].every((r) => r.fetched);
      if (g.lastSeen < idle || caughtUp) { this.groups.delete(gid); n++; }
    }
    return n;
  }

  async epoch() { return this.id; }
  async sizeBytes() {
    let n = 0;
    for (const g of this.groups.values()) {
      for (const b of g.boxes.values()) n += b.sealed.length;
      for (const r of g.rekeys.values()) n += r.sealed.length;
    }
    return n;
  }
  async close() {}
}
