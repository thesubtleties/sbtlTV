import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SyncRecord } from '@sbtltv/core';
import { deriveGroup, tokenHash } from '../protocol/index.js';
import { createApp } from '../server/app.js';
import { Transport } from './transport.js';
import { SyncStore } from './sync-store.js';
import { SyncEngine, uniqueName, type SyncView } from './sync-engine.js';
import { fakeSealer } from './sync-test-helpers.js';

const DAY = 86_400_000;

function world() {
  let relay = createApp({ powBits: 4 });
  let t = Date.UTC(2026, 10, 16);
  const make = (name: string, sealerOn = true, dirPath = mkdtempSync(join(tmpdir(), 'eng-'))) => {
    const got = { applied: [] as SyncRecord[], settings: [] as Record<string, unknown>[], snapshots: 0, views: [] as SyncView[] };
    const e = new SyncEngine({
      store: new SyncStore(join(dirPath, 'sync-state.json'), fakeSealer(sealerOn)),
      transport: (auth) => new Transport({ base: 'http://x', version: '0.17.0', bits: 4, auth, fetch: async (r) => relay.app.fetch(r) }),
      defaultName: name, log: () => {}, timers: false, now: () => t,
      onApply: (r) => { got.applied.push(...r); }, onSettings: (v) => { got.settings.push(v); },
      onSnapshotNeeded: () => { got.snapshots++; }, onChange: (v) => { got.views.push(v); },
    });
    return { e, got, dirPath };
  };
  return {
    make,
    advance: (ms: number) => { t += ms; },
    wipe: () => { relay = createApp({ powBits: 4 }); },
    relay: () => relay,
    now: () => t,
  };
}

async function pair(w: ReturnType<typeof world>) {
  const a = w.make('Linux PC'), b = w.make('Linux PC');
  const payload = await a.e.joinPayload();
  a.e.giverSent();
  expect(a.e.view().status).toBe('pending');
  await b.e.activateJoin(payload, '');
  await a.e.pull();
  return { a, b };
}

const thisId = (e: SyncEngine) => e.view().computers.find((x) => x.thisOne)!.id;
const wl = (at: number, removed?: true): SyncRecord => ({ k: 'wl', type: 'movie', tmdb: 603, name: 'The Matrix', at, ...(removed && { removed }) });

describe('SyncEngine', () => {
  it('pairs: nothing on the relay until the joiner pushes; names are made unique', async () => {
    const w = world();
    const { a, b } = await pair(w);
    expect(a.e.view().status).toBe('active');
    expect(b.e.view().name).toBe('Linux PC 2');
    expect(a.got.snapshots).toBe(1);
    expect(b.got.snapshots).toBe(1);
    expect(a.e.view().computers.map((c) => c.name).sort()).toEqual(['Linux PC', 'Linux PC 2']);
  });

  it('a change on one computer reaches the other once', async () => {
    const w = world(); const { a, b } = await pair(w);
    a.e.record([wl(w.now())]); await a.e.flush();
    await b.e.pull();
    expect(b.got.applied).toEqual([wl(w.now())]);
    await b.e.pull();
    expect(b.got.applied).toHaveLength(1);
  });

  it('a later removal wins over an earlier add (Review Focus 1)', async () => {
    const w = world(); const { a, b } = await pair(w);
    b.e.record([wl(w.now())]); await b.e.flush();
    w.advance(1000);
    a.e.record([wl(w.now(), true)]); await a.e.flush();
    await b.e.pull();
    expect(b.got.applied.at(-1)).toMatchObject({ removed: true });
    await a.e.pull();
    expect(a.got.applied).toEqual([]);
  });

  it('parts: a computer with settings off ignores settings records', async () => {
    const w = world(); const { a, b } = await pair(w);
    a.e.setParts({ watchlist: true, progress: true, settings: true });
    a.e.settingsChanged({ theme: 'light' }); await a.e.flush();
    await b.e.pull();
    expect(b.got.settings).toEqual([]);
    b.e.setParts({ watchlist: true, progress: true, settings: true });
    await b.e.pull();
    expect(b.got.settings).toEqual([{ theme: 'light' }]);
  });

  it('remove: the others move to a new key; the removed computer is told and can follow no further (Review Focus 5)', async () => {
    const w = world(); const { a, b } = await pair(w);
    const c = w.make('Mac');
    await c.e.activateJoin(await a.e.joinPayload(), 'Mac');
    await a.e.pull(); await b.e.pull();
    await a.e.remove(thisId(c.e));
    await b.e.pull();
    expect(b.e.view().status).toBe('active');
    expect(b.e.view().computers.map((x) => x.name).sort()).toEqual(['Linux PC', 'Linux PC 2']);
    a.e.record([wl(w.now())]); await a.e.flush();
    await b.e.pull();
    expect(b.got.applied).toContainEqual(wl(w.now()));
    await c.e.pull();
    expect(c.e.view().status).toBe('removed');
    c.e.record([wl(w.now())]); await c.e.flush();
    expect(c.got.applied).not.toContainEqual(wl(w.now()));
  });

  it('a wiped relay: the next pull puts the box back (Review Focus 4)', async () => {
    const w = world(); const { a, b } = await pair(w);
    a.e.record([wl(w.now())]); await a.e.flush();
    w.wipe();
    await a.e.pull();
    await b.e.pull();
    expect(b.got.applied).toContainEqual(wl(w.now()));
    expect(a.e.view().status).toBe('active');
  });

  it('a computer away for 120 days while the others sync follows a removal it missed (Amendment A)', async () => {
    const w = world(); const { a, b } = await pair(w);
    const c = w.make('Mac');
    await c.e.activateJoin(await a.e.joinPayload(), 'Mac');
    await a.e.pull(); await b.e.pull();
    await a.e.remove(thisId(c.e));   // b is away from here
    for (let i = 0; i < 4; i++) { w.advance(30 * DAY); await a.e.pull(); }
    await b.e.pull();
    expect(b.e.view().status).toBe('active');
    a.e.record([wl(w.now())]); await a.e.flush();
    await b.e.pull();
    expect(b.got.applied).toContainEqual(wl(w.now()));
  });

  it('group missing with the same database id: Sync ended, never recreated (Amendment A)', async () => {
    const w = world(); const { a, b } = await pair(w);
    await a.e.pull();
    const state = JSON.parse(readFileSync(join(a.dirPath, 'sync-state.json'), 'utf8'));
    const { groupId } = deriveGroup(Buffer.from(fakeSealer().open(state.key), 'base64'));
    await b.e.leave();
    await w.relay().groups.deleteBox(groupId, thisId(a.e));
    await a.e.pull();
    expect(a.e.view().status).toBe('ended');
    expect(await w.relay().groups.group(groupId)).toBeNull();
  });

  it('relay wiped after a removal: the remover moves the rebuilt old group again; the removed computer gets nothing (Amendment A)', async () => {
    const w = world(); const { a, b } = await pair(w);
    const c = w.make('Mac');
    await c.e.activateJoin(await a.e.joinPayload(), 'Mac');
    await a.e.pull(); await b.e.pull(); await c.e.pull();
    await a.e.remove(thisId(c.e));   // b and c are away
    w.wipe();
    await a.e.pull();                // a puts its box back in its new group
    await b.e.pull();                // b rebuilds the OLD group
    await c.e.pull();                // so does the removed c
    await a.e.pull();                // a sees the old group alive: moves it again, to b only
    await b.e.pull();
    expect(b.e.view().status).toBe('active');
    expect(b.e.view().computers.map((x) => x.name).sort()).toEqual(['Linux PC', 'Linux PC 2']);
    await c.e.pull();
    expect(c.e.view().status).toBe('removed');
    a.e.record([wl(w.now())]); await a.e.flush();
    await b.e.pull(); await c.e.pull();
    expect(b.got.applied).toContainEqual(wl(w.now()));
    expect(c.got.applied).not.toContainEqual(wl(w.now()));
  });

  it('a keyring that stopped working: status keyring, no crash, nothing sent (Review Focus 3)', async () => {
    const w = world();
    const a = w.make('Mac');
    await a.e.joinPayload();
    const again = w.make('Mac', false, a.dirPath);
    expect(again.e.view().status).toBe('keyring');
    again.e.record([wl(w.now())]);
    await again.e.flush(); await again.e.pull();
    await expect(again.e.joinPayload()).rejects.toThrow();
  });

  it('a pending giver whose computer never joined forgets the key after 15 minutes', async () => {
    const w = world(); const a = w.make('Mac');
    await a.e.joinPayload(); a.e.giverSent();
    w.advance(16 * 60_000);
    await a.e.pull();
    expect(a.e.view().status).toBe('off');
  });

  it('leave: the box goes; the other sees one computer fewer', async () => {
    const w = world(); const { a, b } = await pair(w);
    await b.e.leave();
    expect(b.e.view().status).toBe('off');
    await a.e.pull();
    expect(a.e.view().computers).toHaveLength(1);
  });

  it('a replayed older box is ignored (counter only rises)', async () => {
    const w = world(); const { a, b } = await pair(w);
    const bState = () => JSON.parse(readFileSync(join(b.dirPath, 'sync-state.json'), 'utf8'));
    const g = deriveGroup(Buffer.from(fakeSealer().open(bState().key), 'base64'));
    const bId = thisId(b.e);
    b.e.record([wl(w.now())]); await b.e.flush();
    const before = await w.relay().groups.list(g.groupId, 0, '2026-11-16');
    if (!before || !('boxes' in before)) throw new Error('expected boxes');
    const oldBox = before.boxes.find((x) => x.id === bId)!.sealed;
    w.advance(1000);
    b.e.record([wl(w.now(), true)]); await b.e.flush();
    await a.e.pull();
    const aState = () => JSON.parse(readFileSync(join(a.dirPath, 'sync-state.json'), 'utf8'));
    const newer = aState().others[bId].counter;
    await w.relay().groups.putBox(g.groupId, tokenHash(g.accessToken), bId, oldBox, '2026-11-16');   // the relay serves the old box again
    await a.e.pull();
    expect(aState().others[bId].counter).toBe(newer);
    expect(aState().others[bId].records).toContainEqual(expect.objectContaining({ removed: true }));
  });

  it('uniqueName numbers taken names', () => {
    expect(uniqueName('Mac', [])).toBe('Mac');
    expect(uniqueName('Mac', ['Mac', 'Mac 2'])).toBe('Mac 3');
  });
});
