import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SyncRecord } from '@sbtltv/core';
import { deriveGroup, tokenHash } from '../protocol/index.js';
import { createApp } from '../server/app.js';
import { Transport } from './transport.js';
import { SyncClient } from './sync.js';
import { SyncStore } from './sync-store.js';
import { SyncEngine, uniqueName, type SyncView } from './sync-engine.js';
import { fakeSealer } from './sync-test-helpers.js';

const DAY = 86_400_000;

function world() {
  let t = Date.UTC(2026, 10, 16);
  // The relay keeps the same clock as the computers (its dates decide what its cleanup deletes)
  let relay = createApp({ powBits: 4, now: () => t });
  const make = (name: string, sealerOn = true, dirPath = mkdtempSync(join(tmpdir(), 'eng-'))) => {
    const got = { applied: [] as SyncRecord[], settings: [] as Record<string, unknown>[], snapshots: 0, views: [] as SyncView[] };
    // The page writes what it's handed and confirms it (as App.tsx does after applyRecords)
    const e: SyncEngine = new SyncEngine({
      store: new SyncStore(join(dirPath, 'sync-state.json'), fakeSealer(sealerOn)),
      transport: (auth) => new Transport({ base: 'http://x', version: '0.17.0', bits: 4, auth, fetch: async (r) => relay.app.fetch(r) }),
      defaultName: name, log: () => {}, timers: false, now: () => t,
      onApply: (r) => { got.applied.push(...r); queueMicrotask(() => e.confirm(r)); }, onSettings: (v) => { got.settings.push(v); },
      onSnapshotNeeded: () => { got.snapshots++; }, onChange: (v) => { got.views.push(v); },
    });
    return { e, got, dirPath };
  };
  return {
    make,
    advance: (ms: number) => { t += ms; },
    wipe: () => { relay = createApp({ powBits: 4, now: () => t }); },
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

  it('a computer away for 7 months still follows: the remover keeps the old group alive while someone waits (M1)', async () => {
    const w = world(); const { a, b } = await pair(w);
    const c = w.make('Mac');
    await c.e.activateJoin(await a.e.joinPayload(), 'Mac');
    await a.e.pull(); await b.e.pull();
    await a.e.remove(thisId(c.e));
    for (let i = 0; i < 7; i++) {
      w.advance(30 * DAY);
      await a.e.pull();
      await w.relay().groups.sweep(new Date(w.now()).toISOString().slice(0, 10));
    }
    await b.e.pull();
    expect(b.e.view().status).toBe('active');
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

  it('re-moving a rebuilt old group also seals the key to computers still away (I5)', async () => {
    const w = world(); const { a, b } = await pair(w);
    const c = w.make('Mac'), d = w.make('Den');
    await c.e.activateJoin(await a.e.joinPayload(), 'Mac');
    await d.e.activateJoin(await a.e.joinPayload(), 'Den');
    await a.e.pull(); await b.e.pull(); await c.e.pull(); await d.e.pull();
    await a.e.remove(thisId(c.e));   // b, c and d are away
    w.wipe();
    await a.e.pull();
    await b.e.pull();                // b rebuilds the old group
    await a.e.pull();                // a moves it again: to b AND d (away), not c
    await d.e.pull();                // d comes back later
    expect(d.e.view().status).toBe('active');
    await c.e.pull();
    expect(c.e.view().status).not.toBe('active');
  });

  it('after a relay wipe the remover restores its old group already retired: the away computer follows, the removed one gets nothing and cannot rebuild it', async () => {
    const w = world(); const { a, b } = await pair(w);
    const c = w.make('Mac');
    await c.e.activateJoin(await a.e.joinPayload(), 'Mac');
    await a.e.pull(); await b.e.pull(); await c.e.pull();
    const cState = JSON.parse(readFileSync(join(c.dirPath, 'sync-state.json'), 'utf8'));
    const oldGid = deriveGroup(Buffer.from(fakeSealer().open(cState.key), 'base64')).groupId;
    await a.e.remove(thisId(c.e));   // b and c are away
    w.wipe();
    await a.e.pull();                // a sees the new database and restores the retired marker first
    expect(await w.relay().groups.group(oldGid)).toMatchObject({ moved: true });
    await c.e.pull();                // the removed computer comes back first
    expect(c.e.view().status).toBe('removed');
    await b.e.pull();
    expect(b.e.view().status).toBe('active');
    expect(b.e.view().computers.map((x) => x.name).sort()).toEqual(['Linux PC', 'Linux PC 2']);
    expect(a.e.view().interrupted).toEqual([]);
  });

  it('restoring an older retired group never hands the current key to a computer removed later (security)', async () => {
    const w = world(); const { a, b } = await pair(w);
    const c = w.make('Mac'), d = w.make('Den');
    await c.e.activateJoin(await a.e.joinPayload(), 'Mac');
    await d.e.activateJoin(await a.e.joinPayload(), 'Den');
    await a.e.pull(); await b.e.pull(); await c.e.pull(); await d.e.pull();
    const dOldState = readFileSync(join(d.dirPath, 'sync-state.json'), 'utf8');
    await a.e.remove(thisId(c.e));   // first removal: b is away (so a keeps watching that old group), d stayed
    await d.e.pull(); await a.e.pull();
    await a.e.remove(thisId(d.e));   // second removal: d is out now
    w.wipe();
    await a.e.pull();                // restores the retired markers, sealing the current key to the computers that stayed
    // d, holding the FIRST old key (a copy of its state from before), must find nothing for it
    writeFileSync(join(d.dirPath, 'sync-state.json'), dOldState);
    const d2 = w.make('Den', true, d.dirPath);
    d2.e.start(); await d2.e.pull();
    expect(d2.e.view().status).toBe('removed');
    await b.e.pull();                // b, still entitled, follows
    expect(b.e.view().status).toBe('active');
  });

  it('an old group retired by someone else after a wipe: the remover says which computers to add again', async () => {
    const w = world(); const { a, b } = await pair(w);
    const c = w.make('Mac');
    await c.e.activateJoin(await a.e.joinPayload(), 'Mac');
    await a.e.pull(); await b.e.pull(); await c.e.pull();
    const cState = JSON.parse(readFileSync(join(c.dirPath, 'sync-state.json'), 'utf8'));
    const oldK = Buffer.from(fakeSealer().open(cState.key), 'base64');
    await a.e.remove(thisId(c.e));
    w.wipe();
    // A modified client on the removed computer retires the old group first, with a key it controls
    const old = deriveGroup(oldK);
    const t = new Transport({ base: 'http://x', version: '0.17.0', bits: 4, auth: old.accessToken, fetch: async (r) => w.relay().app.fetch(r) });
    await new SyncClient(t, old.groupId).rekey(new Map());
    await a.e.pull();
    expect(a.e.view().interrupted).toEqual(['Linux PC 2']);
    a.e.dismissInterrupted();
    expect(a.e.view().interrupted).toEqual([]);
  });

  it('a keyring that stopped working: status keyring, no crash, nothing sent (Review Focus 3)', async () => {
    const w = world();
    const a = w.make('Mac');
    await a.e.joinPayload();
    const again = w.make('Mac', false, a.dirPath);
    again.e.start();
    expect(again.e.view().status).toBe('keyring');
    again.e.record([wl(w.now())]);
    await again.e.flush(); await again.e.pull();
    await expect(again.e.joinPayload()).rejects.toThrow();
  });

  it('a keyring reachable only after startup (Linux/Windows before ready): sync opens on start, not "keyring" (C1)', async () => {
    const w = world(); const { a } = await pair(w);
    let on = false;
    const late = { ...fakeSealer(), available: () => on };
    const again = new SyncEngine({
      store: new SyncStore(join(a.dirPath, 'sync-state.json'), late),
      transport: (auth) => new Transport({ base: 'http://x', version: '0.17.0', bits: 4, auth, fetch: async (r) => w.relay().app.fetch(r) }),
      defaultName: 'x', log: () => {}, timers: false, now: w.now,
      onApply: () => {}, onSettings: () => {}, onSnapshotNeeded: () => {}, onChange: () => {},
    });
    expect(again.view().status).not.toBe('keyring');
    on = true;
    again.start();
    await again.pull();
    expect(again.view().status).toBe('active');
  });

  it('a pending giver whose computer never joined forgets the key after 15 minutes', async () => {
    const w = world(); const a = w.make('Mac');
    await a.e.joinPayload(); a.e.giverSent();
    w.advance(16 * 60_000);
    await a.e.pull();
    expect(a.e.view().status).toBe('off');
  });

  it('Add a computer that failed or was cancelled leaves nothing waiting (M4)', async () => {
    const w = world(); const a = w.make('Mac');
    await a.e.joinPayload();
    a.e.abandonPending();
    expect(a.e.view().status).toBe('off');
    const b = w.make('Mac');
    await b.e.joinPayload();                // never rang at all
    w.advance(16 * 60_000);
    await b.e.pull();
    expect(b.e.view().status).toBe('off');
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

  it("a computer carries the changes it received, so they outlive the computer that made them (I3)", async () => {
    const w = world(); const { a, b } = await pair(w);
    const t0 = w.now();
    b.e.record([wl(t0)]); await b.e.flush();          // B: added
    await a.e.pull();
    w.advance(1000);
    a.e.record([wl(w.now(), true)]); await a.e.flush(); // A: removed later
    await b.e.pull(); await b.e.flush();              // B adopts it (its push timer, here by hand)
    await a.e.leave();                                  // A retires
    const c = w.make('Mac');
    await c.e.activateJoin(await b.e.joinPayload(), 'Mac');
    await b.e.pull(); w.advance(31_000); await c.e.pull();
    expect(c.got.applied.filter((r) => r.k === 'wl' && !('removed' in r && r.removed))).toEqual([]);
  });

  it('changes the page never confirmed (window closed, write failed) are handed over again (I2)', async () => {
    const w = world(); const { a } = await pair(w);
    const handed: SyncRecord[] = [];
    const b2 = new SyncEngine({
      store: new SyncStore(join(mkdtempSync(join(tmpdir(), 'eng-')), 'sync-state.json'), fakeSealer()),
      transport: (auth) => new Transport({ base: 'http://x', version: '0.17.0', bits: 4, auth, fetch: async (r) => w.relay().app.fetch(r) }),
      defaultName: 'B', log: () => {}, timers: false, now: w.now,
      onApply: (r) => { handed.push(...r); },   // never confirms: no page listening
      onSettings: () => {}, onSnapshotNeeded: () => {}, onChange: () => {},
    });
    await b2.activateJoin(await a.e.joinPayload(), 'B');
    await a.e.pull();
    a.e.record([wl(w.now())]); await a.e.flush();
    await b2.pull(); await b2.pull();
    expect(handed.filter((r) => r.k === 'wl')).toHaveLength(2);
    b2.confirm(handed);
    await b2.pull();
    expect(handed.filter((r) => r.k === 'wl')).toHaveLength(2);
  });

  it('a box over the size limit leaves out the oldest finished progress, and still sends (M14)', async () => {
    const w = world(); const { a, b } = await pair(w);
    const noise = () => randomBytes(300).toString('base64');   // titles that don't compress
    const finished: SyncRecord[] = Array.from({ length: 4000 }, (_, i) => ({ k: 'pm', tmdb: 10_000 + i, name: noise(), pos: 100, dur: 100, done: true, at: 1_000 + i }));
    const current: SyncRecord = { k: 'pm', tmdb: 42, name: 'Still watching', pos: 50, dur: 100, done: false, at: 2_000 };
    a.e.record([...finished, current]); await a.e.flush();
    await b.e.pull();
    expect(b.got.applied).toContainEqual(current);
    expect(b.got.applied.filter((r) => r.k === 'pm' && r.done).length).toBeLessThan(4000);
  });

  it('uniqueName numbers taken names', () => {
    expect(uniqueName('Mac', [])).toBe('Mac');
    expect(uniqueName('Mac', ['Mac', 'Mac 2'])).toBe('Mac 3');
  });
});
