// packages/mailbox/src/server/groups.test.ts
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AtRestGroupStore } from './at-rest.js';
import { createApp } from './app.js';
import { Downloads } from './limits.js';
import { groupStoreContract } from './groups.contract.js';
import { MemoryGroupStore, dayMinus, utcDay } from './groups.js';

groupStoreContract('memory', async () => new MemoryGroupStore());
groupStoreContract('memory, sealed at rest', async () => new AtRestGroupStore(new MemoryGroupStore(), randomBytes(32)));

describe('sealed at rest', () => {
  it('the store underneath never holds what was uploaded; reads give it back exactly', async () => {
    const inner = new MemoryGroupStore();
    const s = new AtRestGroupStore(inner, randomBytes(32));
    const gid = 'a'.repeat(32), did = 'b'.repeat(32), th = randomBytes(32);
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('readable inside')]);
    await s.putBox(gid, th, did, zip, '2026-11-17');
    await s.createRetired('c'.repeat(32), th, new Map([[did, { sealed: Buffer.from('a key'), ackHash: null }]]), '2026-11-17');
    const raw = await inner.list(gid, 0, '2026-11-17');
    const stored = raw && !('moved' in raw) ? raw.boxes[0].sealed : Buffer.alloc(0);
    expect(stored.includes(Buffer.from('readable'))).toBe(false);
    expect(stored.subarray(0, 4).equals(zip.subarray(0, 4))).toBe(false);
    expect((await inner.getRekey('c'.repeat(32), did, '2026-11-17'))?.includes(Buffer.from('a key'))).toBe(false);
    const back = await s.list(gid, 0, '2026-11-17');
    expect(back && !('moved' in back) && back.boxes[0].sealed.equals(zip)).toBe(true);
    expect((await s.getRekey('c'.repeat(32), did, '2026-11-17'))?.toString()).toBe('a key');
  });

  it('a box moved to another computer or group (or another key) does not open', async () => {
    const inner = new MemoryGroupStore();
    const s = new AtRestGroupStore(inner, randomBytes(32));
    const gid = 'a'.repeat(32), th = randomBytes(32);
    await s.putBox(gid, th, 'b'.repeat(32), Buffer.from('x'), '2026-11-17');
    const raw = await inner.list(gid, 0, '2026-11-17');
    await inner.putBox(gid, th, 'c'.repeat(32), raw && !('moved' in raw) ? raw.boxes[0].sealed : Buffer.alloc(0), '2026-11-17');
    // Left out as missing (its computer puts it back), not a failure of the whole group's reads
    const moved = await s.list(gid, 0, '2026-11-17');
    expect(moved && !('moved' in moved) && moved.boxes.map((b) => b.id)).toEqual(['b'.repeat(32)]);
    expect(moved && !('moved' in moved) && moved.computers.map((c) => c.id)).toEqual(['b'.repeat(32)]);
    let unreadable = 0;
    const other = await new AtRestGroupStore(inner, randomBytes(32), () => { unreadable++; }).list(gid, 0, '2026-11-17');
    expect(other && !('moved' in other) && other.boxes).toEqual([]);
    expect(unreadable).toBe(2);
    expect(await inner.group(gid)).not.toBeNull();   // nothing deleted: a group gone under the same epoch would end sync
  });

  it('a box copied into another group, or a new key into another computer\'s slot, does not open', async () => {
    const inner = new MemoryGroupStore(), relayKey = randomBytes(32);
    const s = new AtRestGroupStore(inner, relayKey);
    const th = randomBytes(32), did = 'b'.repeat(32), other = 'd'.repeat(32);
    await s.putBox('a'.repeat(32), th, did, Buffer.from('x'), '2026-11-17');
    const raw = await inner.list('a'.repeat(32), 0, '2026-11-17');
    await inner.putBox('e'.repeat(32), th, did, raw && !('moved' in raw) ? raw.boxes[0].sealed : Buffer.alloc(0), '2026-11-17');
    const copied = await s.list('e'.repeat(32), 0, '2026-11-17');
    expect(copied && !('moved' in copied) && copied.boxes).toEqual([]);
    await s.createRetired('c'.repeat(32), th, new Map([[did, { sealed: Buffer.from('a key'), ackHash: null }]]), '2026-11-17');
    const key = await inner.getRekey('c'.repeat(32), did, '2026-11-17');
    const copy = new MemoryGroupStore();   // the same group, the key moved to another computer's slot
    await copy.createRetired('c'.repeat(32), th, new Map([[other, { sealed: key!, ackHash: null }]]), '2026-11-17');
    expect(await new AtRestGroupStore(copy, relayKey).getRekey('c'.repeat(32), other, '2026-11-17')).toBeNull();
  });

  it('a relay given a database but no storage key refuses to start', () => {
    expect(() => createApp({ groups: new MemoryGroupStore() })).toThrow(/storage key/);
    expect(() => new AtRestGroupStore(new MemoryGroupStore(), randomBytes(16))).toThrow();
  });
});

describe('download counts', () => {
  it('a late download of an older version leaves the newer count alone', () => {
    const d = new Downloads(() => 0);
    d.add('g/a', 2); d.add('g/a', 2); d.add('g/a', 1);
    expect(d.count('g/a', 2)).toBe(2);
    expect(d.count('g/a', 1)).toBe(0);
  });
});

describe('days', () => {
  it('counts back across months and years', () => {
    expect(dayMinus('2026-03-01', 1)).toBe('2026-02-28');
    expect(dayMinus('2026-01-15', 90)).toBe('2025-10-17');
    expect(utcDay(Date.UTC(2026, 10, 16, 23, 59))).toBe('2026-11-16');
  });
});

describe('the Postgres pool', () => {
  it('survives a dropped connection (an unhandled pool error would end the relay)', async () => {
    const { makePool } = await import('./pg-groups.js');
    const pool = makePool('postgres://nobody@127.0.0.1:1/none');
    expect(() => pool.emit('error', new Error('connection terminated'))).not.toThrow();
    await pool.end();
  });
});
