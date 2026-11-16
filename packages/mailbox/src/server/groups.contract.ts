import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_COMPUTERS } from '../protocol/index.js';
import type { GroupStore } from './groups.js';

const hex = () => randomBytes(16).toString('hex');
const h = () => randomBytes(32);

/** The same behaviour from every GroupStore (memory and Postgres). */
export function groupStoreContract(name: string, make: () => Promise<GroupStore>) {
  describe(`GroupStore contract: ${name}`, () => {
    let s: GroupStore;
    beforeEach(async () => { s = await make(); });

    it('creates a group on the first box and lists it', async () => {
      const gid = hex(), did = hex(), th = h();
      expect(await s.group(gid)).toBeNull();
      const put = await s.putBox(gid, th, did, Buffer.from('a'), '2026-11-16');
      expect(put).toEqual({ seq: 1 });
      expect((await s.group(gid))?.tokenHash.equals(th)).toBe(true);
      const l = await s.list(gid, 0, '2026-11-16');
      expect(l).toMatchObject({ seq: 1, computers: [{ id: did, seq: 1 }] });
      expect(l && !('moved' in l && l.moved) && 'boxes' in l && l.boxes[0].sealed.toString()).toBe('a');
    });

    it('lists only boxes changed after since, but every computer', async () => {
      const gid = hex(), a = hex(), b = hex(), th = h();
      await s.putBox(gid, th, a, Buffer.from('a1'), '2026-11-16');
      await s.putBox(gid, th, b, Buffer.from('b1'), '2026-11-16');
      await s.putBox(gid, th, a, Buffer.from('a2'), '2026-11-16');
      const l = await s.list(gid, 2, '2026-11-16');
      if (!l || !('boxes' in l)) throw new Error('expected a list');
      expect(l.seq).toBe(3);
      expect(l.boxes.map((x) => x.sealed.toString())).toEqual(['a2']);
      expect(l.computers.map((c) => c.id).sort()).toEqual([a, b].sort());
    });

    it('refuses a different token for an existing group', async () => {
      const gid = hex();
      await s.putBox(gid, h(), hex(), Buffer.from('a'), '2026-11-16');
      expect(await s.putBox(gid, h(), hex(), Buffer.from('b'), '2026-11-16')).toBe('denied');
    });

    it('refuses an eleventh computer but lets the ten update', async () => {
      const gid = hex(), th = h(), ids = Array.from({ length: MAX_COMPUTERS }, hex);
      for (const id of ids) await s.putBox(gid, th, id, Buffer.from('x'), '2026-11-16');
      expect(await s.putBox(gid, th, hex(), Buffer.from('x'), '2026-11-16')).toBe('full');
      expect(await s.putBox(gid, th, ids[0], Buffer.from('y'), '2026-11-16')).toMatchObject({ seq: MAX_COMPUTERS + 1 });
    });

    it('a group goes with its last box', async () => {
      const gid = hex(), a = hex(), th = h();
      await s.putBox(gid, th, a, Buffer.from('a'), '2026-11-16');
      await s.deleteBox(gid, a);
      expect(await s.group(gid)).toBeNull();
    });

    it('rekey moves the group: boxes gone, writes refused, each key for its computer only', async () => {
      const gid = hex(), a = hex(), b = hex(), removed = hex(), th = h();
      for (const d of [a, b, removed]) await s.putBox(gid, th, d, Buffer.from(d), '2026-11-16');
      expect(await s.rekey(gid, new Map([[b, Buffer.from('for-b')]]), '2026-11-16')).toBe('ok');
      expect(await s.list(gid, 0, '2026-11-16')).toEqual({ moved: true, waiting: 1 });
      expect(await s.putBox(gid, th, removed, Buffer.from('late'), '2026-11-16')).toBe('moved');
      expect(await s.rekey(gid, new Map(), '2026-11-16')).toBe('moved');
      expect((await s.getRekey(gid, b, '2026-11-16'))?.toString()).toBe('for-b');
      expect(await s.getRekey(gid, removed, '2026-11-16')).toBeNull();
      expect(await s.rekey(hex(), new Map(), '2026-11-16')).toBeNull();
    });

    it('moved: waiting counts keys not yet fetched; a fetch marks it and can be repeated', async () => {
      const gid = hex(), a = hex(), b = hex(), th = h();
      for (const d of [a, b]) await s.putBox(gid, th, d, Buffer.from(d), '2026-11-16');
      await s.rekey(gid, new Map([[a, Buffer.from('A')], [b, Buffer.from('B')]]), '2026-11-16');
      expect(await s.list(gid, 0, '2026-11-16')).toEqual({ moved: true, waiting: 2 });
      expect((await s.getRekey(gid, a, '2026-11-17'))?.toString()).toBe('A');
      expect((await s.getRekey(gid, a, '2026-11-17'))?.toString()).toBe('A');
      expect(await s.list(gid, 0, '2026-11-17')).toEqual({ moved: true, waiting: 1 });
    });

    it('sweep deletes groups nobody checked in with for 90 days, and keeps the rest', async () => {
      const idle = hex(), live = hex(), th = h();
      await s.putBox(idle, th, hex(), Buffer.from('x'), '2026-01-01');
      await s.putBox(live, th, hex(), Buffer.from('x'), '2026-01-01');
      await s.list(live, 0, '2026-03-30');   // a check-in keeps it
      expect(await s.sweep('2026-04-05')).toBe(1);
      expect(await s.group(idle)).toBeNull();
      expect(await s.group(live)).not.toBeNull();
    });

    it('a moved group lives while someone is waiting and keeps checking in, then goes a day after the last pickup', async () => {
      const gid = hex(), a = hex(), th = h();
      await s.putBox(gid, th, a, Buffer.from('a'), '2026-01-01');
      await s.rekey(gid, new Map([[a, Buffer.from('A')]]), '2026-01-01');
      for (const day of ['2026-03-01', '2026-05-01']) { await s.list(gid, 0, day); expect(await s.sweep(day)).toBe(0); }
      await s.getRekey(gid, a, '2026-05-02');
      expect(await s.sweep('2026-05-02')).toBe(0);    // fetched today: kept a day for a lost reply
      expect(await s.sweep('2026-05-03')).toBe(1);
    });

    it('a moved group nobody touches for 90 days goes, waiting or not', async () => {
      const gid = hex(), a = hex(), th = h();
      await s.putBox(gid, th, a, Buffer.from('a'), '2026-01-01');
      await s.rekey(gid, new Map([[a, Buffer.from('A')]]), '2026-01-01');
      expect(await s.sweep('2026-04-05')).toBe(1);
    });

    it('a group can be created already retired (the remover restoring its marker after the relay lost its data)', async () => {
      const gid = hex(), b = hex(), th = h();
      expect(await s.createRetired(gid, th, new Map([[b, Buffer.from('for-b')]]), '2026-11-16')).toBe('ok');
      expect((await s.group(gid))?.tokenHash.equals(th)).toBe(true);
      expect(await s.list(gid, 0, '2026-11-16')).toEqual({ moved: true, waiting: 1 });
      expect(await s.putBox(gid, th, hex(), Buffer.from('rebuild'), '2026-11-16')).toBe('moved');   // can't be rebuilt
      expect((await s.getRekey(gid, b, '2026-11-16'))?.toString()).toBe('for-b');
      expect(await s.createRetired(gid, th, new Map(), '2026-11-16')).toBe('exists');
    });

    it('the epoch stays the same for one database', async () => {
      expect(await s.epoch()).toMatch(/^[0-9a-f]{32}$/);
      expect(await s.epoch()).toBe(await s.epoch());
    });
  });
}
