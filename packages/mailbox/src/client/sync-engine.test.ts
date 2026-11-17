import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { SyncRecord } from '@sbtltv/core';
import { deriveGroup, newDeviceId, newKeyPair, openRekey, sealBox, tokenHash } from '../protocol/index.js';
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
  // A test can answer some requests itself (a relay error, a count) before the relay sees them
  let fault: ((r: Request) => Response | undefined) | null = null;
  const send = async (r: Request) => fault?.(r) ?? relay.app.fetch(r);
  const make = (name: string, sealerOn = true, dirPath = mkdtempSync(join(tmpdir(), 'eng-'))) => {
    const got = { applied: [] as SyncRecord[], settings: [] as Record<string, unknown>[], snapshots: 0, views: [] as SyncView[] };
    const holder = { current: {} as Record<string, unknown> };
    // The page writes what it's handed and confirms it (as App.tsx does after applyRecords)
    const e: SyncEngine = new SyncEngine({
      store: new SyncStore(join(dirPath, 'sync-state.json'), fakeSealer(sealerOn)),
      transport: (auth) => new Transport({ base: 'http://x', version: '0.17.0', bits: 4, auth, fetch: send }),
      defaultName: name, log: () => {}, timers: false, now: () => t,
      onApply: (r) => { got.applied.push(...r); queueMicrotask(() => e.confirm(r)); }, onSettings: (v) => { got.settings.push(v); },
      onSnapshotNeeded: () => { got.snapshots++; }, onChange: (v) => { got.views.push(v); },
      currentSettings: () => holder.current as never,
    });
    return { e, got, dirPath, get current() { return holder.current; }, set current(v: Record<string, unknown>) { holder.current = v; } };
  };
  return {
    make,
    advance: (ms: number) => { t += ms; },
    wipe: () => { relay = createApp({ powBits: 4, now: () => t }); },
    relay: () => relay,
    now: () => t,
    fault: (f: typeof fault) => { fault = f; },
    send,
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

  it('a removed computer with a modified client: marking keys picked up does nothing, and a forged box never gets the current key (review A)', async () => {
    const w = world(); const { a, b } = await pair(w);
    const c = w.make('Mac');
    await c.e.activateJoin(await a.e.joinPayload(), 'Mac');
    await a.e.pull(); await b.e.pull(); await c.e.pull();
    const cState = JSON.parse(readFileSync(join(c.dirPath, 'sync-state.json'), 'utf8'));
    const old = deriveGroup(Buffer.from(fakeSealer().open(cState.key), 'base64'));
    const bId = thisId(b.e);
    await a.e.remove(thisId(c.e));   // b is away
    const t = new Transport({ base: 'http://x', version: '0.17.0', bits: 4, auth: old.accessToken, fetch: async (r) => w.relay().app.fetch(r) });
    const attacker = new SyncClient(t, old.groupId);
    await attacker.fetchRekey(bId);                                   // "picks up" b's key without being able to open it
    expect(await attacker.list(0)).toEqual({ moved: true, waiting: 1 });   // still waiting: the group isn't swept early
    // The relay loses its data; the attacker rebuilds the old group first, with a forged box under b's id
    w.wipe();
    const forged = newKeyPair();
    const box = sealBox(old.encKey, old.groupId, bId, Buffer.from(JSON.stringify({ v: 1, counter: 99, name: 'Linux PC 2', pub: forged.publicRaw.toString('base64'), records: [] })));
    await attacker.push(bId, box);
    await a.e.pull();                                                 // the remover moves the rebuilt group again
    const sealedForB = await attacker.fetchRekey(bId);
    expect(sealedForB).not.toBeNull();
    // Sealed to b's REAL key (recorded at removal), so the forged key can't open it
    expect(() => openRekey(forged, old.macKey, sealedForB!, old.groupId, bId)).toThrow();
    await b.e.pull();
    expect(b.e.view().status).toBe('active');
  });

  it('restoring a retired old group after a wipe is retried until it works (review A3)', async () => {
    const w = world(); const { a, b } = await pair(w);
    const c = w.make('Mac');
    await c.e.activateJoin(await a.e.joinPayload(), 'Mac');
    await a.e.pull(); await b.e.pull(); await c.e.pull();
    await a.e.remove(thisId(c.e));   // b and c are away
    w.wipe();
    let failOnce = true;
    w.fault((r) => {
      if (failOnce && r.method === 'POST' && /\/rekey$/.test(new URL(r.url).pathname)) { failOnce = false; return new Response(JSON.stringify({ error: 'busy' }), { status: 429 }); }
      return undefined;
    });
    await a.e.pull();                // the restore fails once
    await a.e.pull();                // and is tried again
    await c.e.pull();                // the removed computer can't rebuild the old group
    expect(c.e.view().status).toBe('removed');
    await b.e.pull();
    expect(b.e.view().status).toBe('active');
  });

  it('a failed upload is sent on the next pull, even after a restart (review B1)', async () => {
    const w = world(); const { a, b } = await pair(w);
    w.fault((r) => (r.method === 'PUT' && /\/boxes\//.test(new URL(r.url).pathname) ? new Response(JSON.stringify({ error: 'busy' }), { status: 429 }) : undefined));
    a.e.record([wl(w.now())]); await a.e.flush();        // the upload fails (relay busy, offline...)
    w.fault(null);
    const again = w.make('Linux PC', true, a.dirPath);  // sbtlTV restarted before the next try
    again.e.start(); await again.e.pull();
    await b.e.pull();
    expect(b.got.applied).toContainEqual(wl(w.now()));
  });

  it('on start, an active computer asks the page for everything once (changes made while sync had a problem) (review B3)', async () => {
    const w = world(); const { a } = await pair(w);
    const before = a.got.snapshots;
    a.e.start();
    expect(a.got.snapshots).toBe(before + 1);
  });

  it("turning Settings on takes the others' settings; the first computer to turn it on supplies its own (review B5)", async () => {
    const w = world(); const { a, b } = await pair(w);
    a.current = { theme: 'light' }; b.current = { theme: 'dark' };
    b.e.settingsChanged({ theme: 'dark' });      // b changed its look while its Settings switch was off
    w.advance(1000);
    a.e.setParts({ watchlist: true, progress: true, settings: true }); await a.e.flush();   // first: supplies light
    w.advance(1000);
    await b.e.pull();
    b.e.setParts({ watchlist: true, progress: true, settings: true }); await b.e.flush();
    await b.e.pull();
    expect(b.got.settings).toContainEqual({ theme: 'light' });   // b takes a's, not the other way round
    await a.e.pull();
    expect(a.got.settings).not.toContainEqual({ theme: 'dark' });
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

  it('a computer whose count went back (a second copy on its profile, a restored state file) is still heard', async () => {
    const w = world(); const { a, b } = await pair(w);
    const file = join(b.dirPath, 'sync-state.json');
    const earlier = readFileSync(file, 'utf8');
    // Another copy of b keeps sending for a while: the others remember its higher count
    for (let i = 0; i < 3; i++) { w.advance(1000); b.e.record([wl(w.now())]); await b.e.flush(); }
    await a.e.pull();
    // b starts again from the state it had before
    b.e.stop();
    writeFileSync(file, earlier);
    const b2 = w.make('Linux PC', true, b.dirPath);
    b2.e.start(); await b2.e.pull();
    w.advance(1000);
    const later = { k: 'wl', type: 'movie', tmdb: 1830, name: 'Lord of War', at: w.now() } as const;
    b2.e.record([later]); await b2.e.flush();
    await a.e.pull();
    expect(a.got.applied).toContainEqual(later);
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
    // Only the oldest go, and only as many as needed (lens 7)
    const done = b.got.applied.filter((r) => r.k === 'pm' && r.done);
    expect(done.length).toBeGreaterThan(1000);
    expect(done).toContainEqual(finished[3999]);
    expect(done).not.toContainEqual(finished[0]);
  });

  it('a long name that is taken still fits the 40-character limit, so the box is readable (review D1)', () => {
    const long = 'x'.repeat(40);
    expect(uniqueName(long, [long]).length).toBeLessThanOrEqual(40);
    expect(uniqueName(long, [long])).toMatch(/ 2$/);
  });

  it('leave works offline: this computer forgets the group either way (review B6)', async () => {
    const w = world(); const { a, b } = await pair(w);
    w.fault(() => new Response('down', { status: 503 }));
    await b.e.leave();
    expect(b.e.view().status).toBe('off');
    w.fault(null);
    expect(a.e.view().status).toBe('active');
  });

  it('a record dated far in the future from another computer is treated as now (review D6)', async () => {
    const w = world(); const { a, b } = await pair(w);
    a.e.record([wl(w.now() + 100 * DAY)]); await a.e.flush();
    await b.e.pull();
    const got = b.got.applied.find((r) => r.k === 'wl');
    expect(got && got.at).toBeLessThanOrEqual(w.now() + DAY);
  });

  it('uniqueName numbers taken names', () => {
    expect(uniqueName('Mac', [])).toBe('Mac');
    expect(uniqueName('Mac', ['Mac', 'Mac 2'])).toBe('Mac 3');
  });
});

describe('SyncEngine (lens 7)', () => {
  const state = (x: { dirPath: string }) => JSON.parse(readFileSync(join(x.dirPath, 'sync-state.json'), 'utf8'));
  const oldGroupOf = (x: { dirPath: string }) => deriveGroup(Buffer.from(fakeSealer().open(state(x).key), 'base64')).groupId;
  async function trio(w: ReturnType<typeof world>) {
    const { a, b } = await pair(w);
    const c = w.make('Mac');
    await c.e.activateJoin(await a.e.joinPayload(), 'Mac');
    await a.e.pull(); await b.e.pull(); await c.e.pull();
    return { a, b, c };
  }

  it('a pending giver that checks before the other computer joined keeps waiting', async () => {
    const w = world(); const a = w.make('Linux PC'), b = w.make('Mac');
    const payload = await a.e.joinPayload(); a.e.giverSent();
    await a.e.pull();   // the 10-second poll, before b has joined
    expect(a.e.view().status).toBe('pending');
    await b.e.activateJoin(payload, 'Mac');
    await a.e.pull();
    expect(a.e.view().status).toBe('active');
  });

  it('a part turned off is not uploaded', async () => {
    const w = world(); const { a, b } = await pair(w);
    a.e.setParts({ watchlist: true, progress: false, settings: false });
    const pm: SyncRecord = { k: 'pm', tmdb: 42, name: 'Private', pos: 5, dur: 100, done: false, at: w.now() };
    a.e.record([pm, wl(w.now())]); await a.e.flush();
    await b.e.pull();
    expect(b.got.applied).toContainEqual(wl(w.now()));
    expect(b.got.applied).not.toContainEqual(pm);
  });

  it('turning settings on takes the others\' settings at once, not at the next pull', async () => {
    const w = world(); const { a, b } = await pair(w);
    a.e.setParts({ watchlist: true, progress: true, settings: true });
    a.e.settingsChanged({ theme: 'light' }); await a.e.flush();
    await b.e.pull();
    b.e.setParts({ watchlist: true, progress: true, settings: true });
    expect(b.got.settings).toEqual([{ theme: 'light' }]);
  });

  it('changes every few seconds (playback) still go out within 5 minutes', async () => {
    const w = world(); const { a, b } = await pair(w);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const live = new SyncEngine({
        store: new SyncStore(join(a.dirPath, 'sync-state.json'), fakeSealer()),
        transport: (auth) => new Transport({ base: 'http://x', version: '0.17.0', bits: 4, auth, fetch: w.send }),
        defaultName: 'x', log: () => {}, timers: true, now: w.now,
        onApply: () => {}, onSettings: () => {}, onSnapshotNeeded: () => {}, onChange: () => {},
      });
      for (let i = 0; i < 80; i++) {
        live.record([{ k: 'pm', tmdb: 42, name: 'Playing', pos: i, dur: 1000, done: false, at: w.now() }]);
        w.advance(4_000); await vi.advanceTimersByTimeAsync(4_000);
      }
      live.stop();
    } finally { vi.useRealTimers(); }
    await b.e.pull();
    expect(b.got.applied.some((r) => r.k === 'pm')).toBe(true);
  });

  it('removals older than 90 days drop out of its own records', async () => {
    const w = world(); const { a } = await pair(w);
    a.e.record([wl(w.now(), true)]);
    w.advance(91 * DAY);
    a.e.record([{ k: 'pm', tmdb: 1, name: '', pos: 1, dur: 2, done: false, at: w.now() }]);
    expect((state(a).own as SyncRecord[]).map((r) => r.k)).toEqual(['pm']);
  });

  it('the newest 20,000 of its own records are kept', async () => {
    const w = world(); const { a } = await pair(w);
    a.e.record(Array.from({ length: 20_001 }, (_, i) => ({ k: 'pm' as const, tmdb: i + 1, name: '', pos: 1, dur: 2, done: false, at: w.now() + i })));
    const own = state(a).own as SyncRecord[];
    expect(own).toHaveLength(20_000);
    expect(own.some((r) => r.k === 'pm' && r.tmdb === 1)).toBe(false);
  });

  it('after a removal, a follower gets what the remover had not sent yet (reads the new group from the start)', async () => {
    const w = world(); const { a, b, c } = await trio(w);
    for (let i = 0; i < 3; i++) { w.advance(1000); b.e.record([{ k: 'pm', tmdb: 50 + i, name: 'x', pos: 1, dur: 2, done: false, at: w.now() }]); await b.e.flush(); }
    await a.e.pull(); await b.e.pull();   // the old group's numbering is well ahead now
    w.advance(1000);
    const late: SyncRecord = { k: 'pm', tmdb: 99, name: 'Late', pos: 1, dur: 2, done: false, at: w.now() };
    a.e.record([late]);                  // not pushed yet: it goes out with the removal
    await a.e.remove(thisId(c.e));
    await b.e.pull();
    expect(b.got.applied).toContainEqual(late);
  });

  it('the remover retires its old group even when another computer put the new group back first', async () => {
    const w = world(); const { a, b, c } = await trio(w);
    await a.e.remove(thisId(c.e));
    await b.e.pull();                    // b follows
    w.wipe();
    await b.e.pull();                    // b puts the NEW group back first
    await a.e.pull();                    // a: its group is there, but the database is new
    await c.e.pull();                    // the removed computer comes back
    expect(c.e.view().status).toBe('removed');
  });

  it('if restoring the retired marker fails, the remover still moves the rebuilt old group again, without the removed computer', async () => {
    const w = world(); const { a, b, c } = await trio(w);
    await a.e.remove(thisId(c.e));       // b and c are away
    w.wipe();
    w.fault((r) => (r.method === 'POST' && r.url.endsWith('/rekey') ? new Response('', { status: 503 }) : undefined));
    await a.e.pull();                    // the restore can't reach the relay
    w.fault(null);
    await b.e.pull(); await c.e.pull();  // both rebuild the old group
    await a.e.pull();                    // a sees it alive: moves it again, to b only
    await b.e.pull(); await c.e.pull();
    expect(b.e.view().status).toBe('active');
    expect(b.e.view().computers.map((x) => x.name).sort()).toEqual(['Linux PC', 'Linux PC 2']);
    expect(c.e.view().status).toBe('removed');
    await a.e.pull();
    expect(a.e.view().interrupted).toEqual([]);   // its own move is not "someone else's"
  });

  it('an old group squatted by someone without its key also says which computers to add again', async () => {
    const w = world(); const { a, c } = await trio(w);
    const oldGid = oldGroupOf(c);
    await a.e.remove(thisId(c.e));
    w.wipe();
    await w.relay().groups.putBox(oldGid, randomBytes(32), newDeviceId(), Buffer.from('x'), '2026-11-16');
    await a.e.pull();
    expect(a.e.view().interrupted).toEqual(['Linux PC 2']);
  });

  it('a computer to add again drops off the list once it is back', async () => {
    const w = world(); const { a, b, c } = await trio(w);
    const old = deriveGroup(Buffer.from(fakeSealer().open(state(c).key), 'base64'));
    await a.e.remove(thisId(c.e));
    w.wipe();
    const t = new Transport({ base: 'http://x', version: '0.17.0', bits: 4, auth: old.accessToken, fetch: w.send });
    await new SyncClient(t, old.groupId).rekey(new Map());
    await a.e.pull();
    expect(a.e.view().interrupted).toEqual(['Linux PC 2']);
    await a.e.pull();                    // its next regular pull (drops computers no longer in its group)
    await b.e.activateJoin(await a.e.joinPayload(), 'Linux PC 2');
    await a.e.pull();
    expect(a.e.view().interrupted).toEqual([]);
  });

  it('old groups are watched only while someone still waits for a key, by the follower too', async () => {
    const w = world(); const { a, b, c } = await trio(w);
    const d = w.make('Den');
    await d.e.activateJoin(await a.e.joinPayload(), 'Den');
    await a.e.pull(); await b.e.pull(); await c.e.pull();
    await a.e.remove(thisId(c.e));
    await b.e.pull();                    // b follows; d is still away
    expect(state(b).previous).toHaveLength(1);
    await d.e.pull(); await a.e.pull(); await b.e.pull();
    expect(state(a).previous).toEqual([]);
    expect(state(b).previous).toEqual([]);
  });

  it('joining another group leaves the old one; the name is trimmed and fits in a box', async () => {
    const w = world(); const { a, b } = await pair(w);
    const d = w.make('Den');
    const payload = await d.e.joinPayload(); d.e.giverSent();
    await b.e.activateJoin(payload, `  ${'x'.repeat(60)}  `);
    expect(b.e.view().name).toBe('x'.repeat(40));
    await a.e.pull();
    expect(a.e.view().computers.map((x) => x.name)).toEqual(['Linux PC']);
    await d.e.pull();
    expect(d.e.view().computers.map((x) => x.name)).toContain('x'.repeat(40));
  });

  it('removing a computer that is not in the group changes nothing', async () => {
    const w = world(); const { a } = await pair(w);
    const before = state(a).key;
    await a.e.remove(newDeviceId());
    expect(state(a).key).toBe(before);
    expect(state(a).removedIds).toEqual([]);
  });

  it('"update the app" clears once the relay accepts this version again', async () => {
    const w = world(); const { a } = await pair(w);
    w.fault(() => new Response(JSON.stringify({ error: 'update' }), { status: 426 }));
    await a.e.pull();
    expect(a.e.view().status).toBe('update');
    w.fault(null);
    await a.e.pull();
    expect(a.e.view().status).toBe('active');
  });

  it('a nudge right after a pull does not ask the relay again', async () => {
    const w = world(); const { a } = await pair(w);
    let lists = 0;
    w.fault((r) => { if (r.method === 'GET' && r.url.includes('/boxes?')) lists++; return undefined; });
    await a.e.pull();
    a.e.nudge();
    await a.e.pull();
    expect(lists).toBe(2);
    w.advance(31_000);
    a.e.nudge();
    await a.e.pull();
    expect(lists).toBe(4);
  });
});
