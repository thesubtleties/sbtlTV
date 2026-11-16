// packages/mailbox/src/client/sync-engine.ts
/**
 * Sync on one computer: keeps its own records, pushes its sealed box after changes, pulls the
 * other computers' boxes, merges (newest wins, removals included) and hands the winners to the app.
 * The relay sees only sealed boxes. Logs carry event names only.
 */
import { randomBytes } from 'node:crypto';
import { isNewer, mergeRecords, pruneTombstones, recordKey, recordPart, validateRecord, type SyncRecord, type SyncedSettingKey } from '@sbtltv/core';
import { GROUP_IDLE_DAYS, MAX_BOX_BYTES, decodeB64, deriveGroup, newDeviceId, newKeyPair, openBox, openRekey, sealBox, sealRekey, type KeyPair } from '../protocol/index.js';
import { MailboxError, type Transport } from './transport.js';
import { SyncClient } from './sync.js';
import { DEFAULT_PARTS, KeyringUnavailable, type Parts, type SyncFile, type SyncStore } from './sync-store.js';

export interface JoinPayload { key: string; computers: { id: string; name: string }[] }
export type SyncViewStatus = 'off' | 'pending' | 'active' | 'removed' | 'ended' | 'keyring' | 'update';
export interface SyncView {
  status: SyncViewStatus; lastSync: number | null; parts: Parts; name: string | null;
  defaultName: string;   // this computer's platform name, for "Name this computer" before sync is on
  /** Computers to add again (an old group was retired by someone else after the relay lost its data) */
  interrupted: string[];
  computers: { id: string; name: string; thisOne: boolean; lastSeen: number | null }[];
}
export interface EngineDeps {
  store: SyncStore; transport: (accessToken: string) => Transport; defaultName: string;
  log: (m: string) => void; onApply: (records: SyncRecord[]) => void;
  onSettings: (values: Partial<Record<SyncedSettingKey, unknown>>) => void;
  onSnapshotNeeded: () => void; onChange: (v: SyncView) => void;
  now?: () => number; timers?: boolean;
}

const DAY = 86_400_000;
const PUSH_DELAY_MS = 5_000;
const PUSH_MAX_WAIT_MS = 5 * 60_000;
const PULL_EVERY_MS = 10 * 60_000;
const NUDGE_GAP_MS = 30_000;
const PENDING_MS = 15 * 60_000;
const PENDING_POLL_MS = 10_000;
const MAX_OWN_RECORDS = 20_000;
const NAME_MAX = 40;

export function uniqueName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) if (!taken.includes(`${base} ${i}`)) return `${base} ${i}`;
}

/** Another computer's box, rebuilt from known fields; null if it isn't one. */
function parseBox(plain: Buffer): { counter: number; name: string; pub: string; records: SyncRecord[] } | null {
  let v: unknown;
  try { v = JSON.parse(plain.toString('utf8')); } catch { return null; }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (o.v !== 1 || !Number.isSafeInteger(o.counter) || (o.counter as number) < 1) return null;
  if (typeof o.name !== 'string' || o.name.length === 0 || o.name.length > NAME_MAX) return null;
  try { decodeB64(o.pub, 32); } catch { return null; }
  if (!Array.isArray(o.records) || o.records.length > MAX_OWN_RECORDS) return null;
  const records = o.records.map(validateRecord).filter((r): r is SyncRecord => r !== null);
  return { counter: o.counter as number, name: o.name, pub: o.pub as string, records };
}

export class SyncEngine {
  private f: SyncFile | null;
  private keys: { K: Buffer; device: KeyPair; encKey: Buffer; groupId: string; client: SyncClient } | null = null;
  private problem: 'keyring' | 'update' | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private pullTimer: ReturnType<typeof setInterval> | null = null;
  private pendingTimer: ReturnType<typeof setInterval> | null = null;
  private firstDirty: number | null = null;
  private lastPullAt = -Infinity;

  constructor(private d: EngineDeps) {
    // The keys are opened later (ready()): on Linux and Windows the OS keyring isn't reachable
    // until Electron is ready, and a "keyring" decided too early would stick
    this.f = d.store.load();
  }

  /** Opens the keys if they aren't open yet, or retries after a keyring that wasn't reachable. */
  private ready(): boolean {
    if (!this.f) return false;
    if (!this.keys || this.problem === 'keyring') this.unlock();
    return !!this.keys && this.problem !== 'keyring';
  }

  private now() { return (this.d.now ?? Date.now)(); }
  private timers() { return this.d.timers !== false; }

  /** One thing at a time (push, pull, remove, leave), in order; a failure doesn't stop the next. */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn);
    this.chain = p.catch(() => {});
    return p;
  }

  private unlock(): void {
    try {
      const { K, device } = this.d.store.open(this.f!);
      this.setKey(K, device);
      this.problem = null;
    } catch (e) {
      if (!(e instanceof KeyringUnavailable)) throw e;
      this.problem = 'keyring';
      this.d.log('Sync: the keyring could not open the sync key');
    }
  }

  private setKey(K: Buffer, device: KeyPair) {
    const g = deriveGroup(K);
    this.keys = { K, device, encKey: g.encKey, groupId: g.groupId, client: new SyncClient(this.d.transport(g.accessToken), g.groupId) };
  }

  private save() { if (this.f) this.d.store.save(this.f); }
  private emit() { this.d.onChange(this.view()); }

  view(): SyncView {
    const f = this.f;
    if (!f) return { status: 'off', lastSync: null, parts: { ...DEFAULT_PARTS }, name: null, defaultName: this.d.defaultName, interrupted: [], computers: [] };
    return {
      status: this.problem ?? f.status, lastSync: f.lastSync, parts: f.parts, name: f.name, defaultName: this.d.defaultName,
      interrupted: f.interrupted,
      computers: [
        { id: f.deviceId, name: f.name, thisOne: true, lastSeen: null },
        ...Object.entries(f.others).map(([id, o]) => ({ id, name: o.name, thisOne: false, lastSeen: o.seenAt })),
      ],
    };
  }

  start(): void {
    this.ready();
    this.emit();
    void this.pull();
    if (this.timers() && !this.pullTimer) {
      this.pullTimer = setInterval(() => void this.pull(), PULL_EVERY_MS);
      this.pullTimer.unref?.();
    }
  }

  stop(): void {
    for (const t of [this.pullTimer, this.pendingTimer]) if (t) clearInterval(t);
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pullTimer = this.pendingTimer = this.pushTimer = null;
  }

  nudge(): void {
    if (this.now() - this.lastPullAt < NUDGE_GAP_MS) return;
    void this.pull();
  }

  record(records: SyncRecord[]): void {
    const f = this.f;
    if (!f || !this.ready() || f.status !== 'active') return;
    const own = new Map(f.own.map((r) => [recordKey(r), r]));
    let changed = false;
    for (const r of records) {
      const k = recordKey(r);
      if (isNewer(r, own.get(k))) { own.set(k, r); changed = true; }
      // The page made it, so its lists already have it: never hand it back
      if ((f.applied[k] ?? 0) < r.at) f.applied[k] = r.at;
    }
    if (!changed) return;
    let list = [...pruneTombstones(own, this.now()).values()];
    if (list.length > MAX_OWN_RECORDS) list = list.sort((a, b) => b.at - a.at).slice(0, MAX_OWN_RECORDS);
    f.own = list;
    this.save();
    this.schedulePush();
  }

  settingsChanged(values: Partial<Record<SyncedSettingKey, unknown>>): void {
    const at = this.now();
    this.record(Object.entries(values).filter(([, v]) => v !== undefined).map(([key, value]) => ({ k: 'set', key: key as SyncedSettingKey, value, at })));
  }

  private schedulePush(): void {
    if (!this.timers()) { this.firstDirty ??= this.now(); return; }
    const now = this.now();
    this.firstDirty ??= now;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    const wait = Math.min(PUSH_DELAY_MS, Math.max(0, this.firstDirty + PUSH_MAX_WAIT_MS - now));
    this.pushTimer = setTimeout(() => void this.run(() => this.pushNow()), wait);
    this.pushTimer.unref?.();
  }

  flush(): Promise<void> {
    return this.firstDirty === null ? Promise.resolve() : this.run(() => this.pushNow());
  }

  private async pushNow(): Promise<void> {
    const f = this.f, k = this.keys;
    if (this.pushTimer) { clearTimeout(this.pushTimer); this.pushTimer = null; }
    this.firstDirty = null;
    if (!f || !k || this.problem === 'keyring' || f.status !== 'active') return;
    f.counter += 1;
    let records = f.own.filter((r) => f.parts[recordPart(r)]);
    const seal = () => sealBox(k.encKey, k.groupId, f.deviceId, Buffer.from(JSON.stringify({ v: 1, counter: f.counter, name: f.name, pub: f.pub, records })));
    let sealed = seal();
    // Over the limit (years of history): leave the oldest finished titles out of the box until it
    // fits. They stay finished on this computer; they just stop syncing.
    if (sealed.length > MAX_BOX_BYTES) {
      const finished = records.filter((r) => (r.k === 'pm' || r.k === 'pe') && r.done).sort((x, y) => x.at - y.at);
      let drop = 0;
      while (sealed.length > MAX_BOX_BYTES && drop < finished.length) {
        drop = Math.min(finished.length, drop + Math.max(1, Math.ceil(finished.length / 8)));
        const out = new Set(finished.slice(0, drop));
        records = records.filter((r) => !out.has(r));
        sealed = seal();
      }
      this.d.log('Sync: the box was over the size limit; left out the oldest finished titles');
    }
    this.save();
    if (sealed.length > MAX_BOX_BYTES) { this.d.log('Sync: this computer\'s box is over the size limit'); return; }
    try {
      await k.client.push(f.deviceId, sealed);
      if (this.problem === 'update') { this.problem = null; this.emit(); }
    } catch (e) {
      this.firstDirty ??= this.now();   // try again with the next pull
      await this.failed(e);
    }
  }

  private async failed(e: unknown): Promise<void> {
    if (e instanceof MailboxError) {
      if (e.code === 'update') { this.problem = 'update'; this.emit(); return; }
      if (e.code === 'moved') { await this.followMove(); return; }
      if (e.code === 'offline' || e.code === 'busy' || e.code === 'cancelled') return;
      this.d.log(`Sync: the relay said ${e.code}`);
      return;
    }
    this.d.log('Sync: unexpected error');
  }

  pull(): Promise<void> { return this.run(() => this.pullNow()); }

  private async pullNow(): Promise<void> {
    this.ready();
    const f = this.f, k = this.keys;
    if (!f || !k || this.problem === 'keyring' || (f.status !== 'active' && f.status !== 'pending')) return;
    this.lastPullAt = this.now();
    let l: Awaited<ReturnType<SyncClient['list']>>;
    try { l = await k.client.list(f.since); } catch (e) { await this.failed(e); return; }
    if (this.problem === 'update') this.problem = null;
    const now = this.now();
    if (l === null) {
      if (f.status === 'pending') { if (f.pendingUntil !== null && now > f.pendingUntil) this.forget(); return; }
      // Same database: the group was really deleted (unused 90 days, or everyone else left) - never
      // rebuild it. A new database: the relay lost its data (a cache) - put this computer's box back.
      let epoch: string;
      try { epoch = await k.client.epoch(); } catch (e) { await this.failed(e); return; }
      if (f.epoch !== null && epoch === f.epoch) { f.status = 'ended'; this.save(); this.emit(); return; }
      f.epoch = epoch;
      await this.retirePrevious();   // before anyone who was away can rebuild an old group
      f.since = 0;
      await this.pushNow();
      f.lastSync = now;
      await this.touchPrevious();
      this.save(); this.emit();
      return;
    }
    if (l.moved) { await this.followMove(); return; }
    // A new database id: the relay lost its data and the group was rebuilt, so its numbering
    // started again. Read everything again.
    const wiped = f.epoch !== null && l.epoch !== f.epoch;
    if (wiped && f.since > 0) {
      f.since = 0;
      try { l = await k.client.list(0); } catch (e) { await this.failed(e); return; }
      if (l === null || l.moved) return;
    }
    f.epoch = l.epoch;
    if (wiped) await this.retirePrevious();
    for (const b of l.boxes) if (b.id !== f.deviceId) this.takeBox(b.id, b.seq, b.sealed, now);
    const present = new Set(l.computers.map((c) => c.id));
    for (const id of Object.keys(f.others)) if (!present.has(id)) delete f.others[id];
    // A computer that was to be added again is back
    if (f.interrupted.length) f.interrupted = f.interrupted.filter((n) => !Object.values(f.others).some((o) => o.name === n));
    f.since = l.seq;
    if (f.status === 'pending' && Object.keys(f.others).length > 0) {
      f.status = 'active'; f.pendingUntil = null;
      this.d.onSnapshotNeeded();
    }
    if (f.status === 'active' && !present.has(f.deviceId)) await this.pushNow();
    f.lastSync = now;
    this.applyWinners();
    await this.touchPrevious();
    this.save(); this.emit();
  }

  /**
   * Groups this computer moved away from (Amendment A). Checking one keeps it alive on the relay
   * until every remaining computer has fetched its new key; then it's forgotten. If one comes back
   * to life (the relay lost its data and an away computer rebuilt it), the computer that removed
   * someone moves it again, sealing the current key only to computers it didn't remove.
   */
  private async touchPrevious(): Promise<void> {
    const f = this.f!, k = this.keys!;
    const keep: SyncFile['previous'] = [];
    for (const p of f.previous) {
      let old: { K: Buffer };
      try { old = this.d.store.open({ ...f, key: p.key }); } catch { continue; }
      const g = deriveGroup(old.K);
      const client = new SyncClient(this.d.transport(g.accessToken), g.groupId);
      try {
        const l = await client.list(0);
        // Retired in this database, but not by this computer: someone else took the old group
        if (l && l.moved && p.removed.length > 0 && p.markedIn !== f.epoch) { this.interrupt(p); continue; }
        if (l && l.moved && l.waiting === 0) continue;   // everyone has caught up
        // Gone from the relay and not back for 90 days: nobody will rebuild it now. While it's there
        // and someone still waits for a key, it's kept alive however long that takes.
        if (l === null && this.now() - p.at > GROUP_IDLE_DAYS * DAY) continue;
        if (l && !l.moved && p.removed.length > 0) {
          const keys = new Map<string, Buffer>();
          for (const b of l.boxes) {
            if (b.id === f.deviceId || p.removed.includes(b.id)) continue;
            let box: ReturnType<typeof parseBox>;
            try { box = parseBox(openBox(g.encKey, g.groupId, b.id, b.sealed)); } catch { box = null; }
            if (box) keys.set(b.id, sealRekey(decodeB64(box.pub, 32), g.encKey, k.K, g.groupId, b.id));
          }
          // And the computers that stayed but are still away (no box here yet): they'd otherwise look removed
          for (const [id, pub] of Object.entries(p.members ?? {})) {
            if (id === f.deviceId || p.removed.includes(id) || keys.has(id)) continue;
            try { keys.set(id, sealRekey(decodeB64(pub, 32), g.encKey, k.K, g.groupId, id)); } catch { /* a bad key: skip */ }
          }
          try {
            await client.rekey(keys);
            p.markedIn = f.epoch;
            this.d.log('Sync: an old group came back; moved it again');
          } catch (e) {
            if (e instanceof MailboxError && (e.code === 'moved' || e.code === 'denied')) { this.interrupt(p); continue; }
            throw e;
          }
        }
      } catch { /* keep it for next time */ }
      keep.push(p);
    }
    f.previous = keep;
  }

  private takeBox(id: string, seq: number, sealed: Buffer, now: number): void {
    const f = this.f!, k = this.keys!;
    let box: ReturnType<typeof parseBox>;
    try { box = parseBox(openBox(k.encKey, k.groupId, id, sealed)); } catch { box = null; }
    if (!box) { this.d.log('Sync: a box could not be opened'); return; }
    const prev = f.others[id];
    if (prev && box.counter <= prev.counter) return;   // an old box again
    f.others[id] = { name: box.name, pub: box.pub, counter: box.counter, seq, records: box.records, seenAt: now };
  }

  private applyWinners(): void {
    const f = this.f!;
    const own = new Map(f.own.map((r) => [recordKey(r), r]));
    const merged = mergeRecords([f.own, ...Object.values(f.others).map((o) => o.records)]);
    const out: SyncRecord[] = [];
    const settings: Partial<Record<SyncedSettingKey, unknown>> = {};
    let adopted = false;
    for (const [key, w] of merged) {
      if (!f.parts[recordPart(w)]) continue;
      // This computer now carries the winner too, so it outlives the computer that made it
      if (own.get(key) !== w && isNewer(w, own.get(key))) { own.set(key, w); adopted = true; }
      if ((f.applied[key] ?? 0) >= w.at) continue;
      // Settings are applied here in main; lists count as applied only once the page confirms (confirm())
      if (w.k === 'set') { settings[w.key] = w.value; f.applied[key] = w.at; } else out.push(w);
    }
    f.applied = Object.fromEntries(Object.entries(f.applied).filter(([key]) => merged.has(key)));
    if (adopted) { f.own = [...own.values()]; this.schedulePush(); }
    if (out.length) this.d.onApply(out);
    if (Object.keys(settings).length) this.d.onSettings(settings);
  }

  /** The page wrote these records into its lists: they won't be handed over again. */
  confirm(records: SyncRecord[]): void {
    const f = this.f;
    if (!f) return;
    for (const r of records) {
      const key = recordKey(r);
      if ((f.applied[key] ?? 0) < r.at) f.applied[key] = r.at;
    }
    this.save();
  }

  private async followMove(): Promise<void> {
    const f = this.f!, k = this.keys!;
    let sealed: Buffer | null;
    try { sealed = await k.client.fetchRekey(f.deviceId); } catch (e) { if (!(e instanceof MailboxError && e.code === 'moved')) await this.failed(e); return; }
    let newK: Buffer | null = null;
    if (sealed) {
      try { newK = openRekey(k.device, k.encKey, sealed, k.groupId, f.deviceId); } catch { this.d.log('Sync: the new key could not be opened'); }
    }
    if (!newK) { f.status = 'removed'; this.save(); this.emit(); return; }
    f.previous.push({ key: f.key, removed: [], at: this.now() });
    this.switchKey(newK);
    await this.pushNow();
    await this.pullNow();
  }

  private switchKey(newK: Buffer): void {
    const f = this.f!, k = this.keys!;
    f.key = this.d.store.seal(newK, k.device).key;
    f.since = 0;
    this.setKey(newK, k.device);
    this.save();
  }

  private newFile(status: 'pending' | 'active', K: Buffer, name: string): void {
    const device = newKeyPair();
    const sealed = this.d.store.seal(K, device);   // throws KeyringUnavailable: nothing is kept
    this.f = {
      v: 1, status, ...sealed, deviceId: newDeviceId(), pub: device.publicRaw.toString('base64'), name,
      counter: 0, parts: { ...DEFAULT_PARTS }, own: [], others: {}, since: 0, lastSync: null,
      // A pending group the other computer never joins is forgotten (giverSent restarts the clock)
      pendingUntil: status === 'pending' ? this.now() + PENDING_MS : null, applied: {},
      epoch: null, previous: [], interrupted: [],
    };
    this.setKey(K, device);
    this.problem = null;
    this.save();
  }

  async joinPayload(): Promise<JoinPayload> {
    if (this.f && !this.ready()) throw new KeyringUnavailable();
    const f0 = this.f;
    if (!f0 || f0.status === 'removed' || f0.status === 'ended') this.newFile('pending', randomBytes(32), this.d.defaultName);
    const f = this.f!;
    return {
      key: this.keys!.K.toString('base64'),
      computers: [{ id: f.deviceId, name: f.name }, ...Object.entries(f.others).map(([id, o]) => ({ id, name: o.name }))],
    };
  }

  /** The relay lost its data: put this computer's retired markers back (old groups it removed someone from), sealing the current key to the computers that stayed. */
  private async retirePrevious(): Promise<void> {
    const f = this.f!, k = this.keys!;
    for (const p of f.previous) {
      if (p.removed.length === 0 || p.markedIn === f.epoch) continue;
      let old: { K: Buffer };
      try { old = this.d.store.open({ ...f, key: p.key }); } catch { continue; }
      const g = deriveGroup(old.K);
      const keys = new Map<string, Buffer>();
      for (const [id, pub] of Object.entries(p.members ?? {})) {
        if (id === f.deviceId || p.removed.includes(id)) continue;
        try { keys.set(id, sealRekey(decodeB64(pub, 32), g.encKey, k.K, g.groupId, id)); } catch { /* a bad key: skip */ }
      }
      try {
        await new SyncClient(this.d.transport(g.accessToken), g.groupId).rekey(keys);
        p.markedIn = f.epoch;
        this.d.log('Sync: the relay lost its data; put an old group back as retired');
      } catch (e) {
        if (e instanceof MailboxError && (e.code === 'moved' || e.code === 'denied')) this.interrupt(p);
      }
    }
  }

  /** Someone else took an old group after the relay lost its data: say which computers to add again. */
  private interrupt(p: SyncFile['previous'][number]): void {
    const f = this.f!;
    const names = Object.entries(p.names ?? {}).filter(([id]) => !p.removed.includes(id) && id !== f.deviceId).map(([, n]) => n);
    f.interrupted = [...new Set([...f.interrupted, ...names])];
    p.markedIn = f.epoch;   // said once
    this.d.log('Sync: an old group was retired by someone else');
  }

  dismissInterrupted(): void {
    if (!this.f) return;
    this.f.interrupted = [];
    this.save(); this.emit();
  }

  /** "Add a computer" failed or was cancelled before anyone joined: forget the pending group. */
  abandonPending(): void {
    if (this.f?.status === 'pending' && Object.keys(this.f.others).length === 0) this.forget();
  }

  giverSent(): void {
    const f = this.f;
    if (!f || f.status !== 'pending') return;
    f.pendingUntil = this.now() + PENDING_MS;
    this.save();
    if (this.timers() && !this.pendingTimer) {
      this.pendingTimer = setInterval(() => {
        if (this.f?.status !== 'pending') { clearInterval(this.pendingTimer!); this.pendingTimer = null; return; }
        void this.pull();
      }, PENDING_POLL_MS);
      this.pendingTimer.unref?.();
    }
  }

  activateJoin(join: JoinPayload, name: string): Promise<void> {
    return this.run(async () => {
      if (this.f && this.keys && this.f.status === 'active') {
        try { await this.keys.client.leave(this.f.deviceId); } catch { /* the old group notices on its own */ }
      }
      const K = decodeB64(join.key, 32);
      const wanted = name.trim().slice(0, NAME_MAX) || this.d.defaultName;
      this.newFile('active', K, uniqueName(wanted, join.computers.map((c) => c.name)));
      this.d.onSnapshotNeeded();
      await this.pushNow();   // the giver is waiting for this box
      await this.pullNow();
      this.emit();
    });
  }

  remove(deviceId: string): Promise<void> {
    return this.run(async () => {
      const f = this.f, k = this.keys;
      if (!f || !k || f.status !== 'active' || !f.others[deviceId]) return;
      const newK = randomBytes(32);
      const keys = new Map<string, Buffer>();
      for (const [id, o] of Object.entries(f.others)) {
        if (id !== deviceId) keys.set(id, sealRekey(decodeB64(o.pub, 32), k.encKey, newK, k.groupId, id));
      }
      await k.client.rekey(keys);   // a relay error reaches the caller: nothing changed here yet
      const stayed = Object.entries(f.others).filter(([id]) => id !== deviceId);
      const members = Object.fromEntries(stayed.map(([id, o]) => [id, o.pub]));
      const names = Object.fromEntries(stayed.map(([id, o]) => [id, o.name]));
      delete f.others[deviceId];
      f.previous.push({ key: f.key, removed: [deviceId], at: this.now(), members, names, markedIn: f.epoch });
      this.switchKey(newK);
      await this.pushNow();
      this.emit();
    });
  }

  leave(): Promise<void> {
    return this.run(async () => {
      const f = this.f, k = this.keys;
      if (f && k && f.status === 'active' && this.problem !== 'keyring') {
        try { await k.client.leave(f.deviceId); } catch (e) { if (!(e instanceof MailboxError && (e.code === 'moved' || e.code === 'not-found'))) throw e; }
      }
      this.forget();
    });
  }

  private forget(): void {
    this.d.store.clear();
    this.f = null; this.keys = null; this.problem = null;
    this.stop();
    if (this.timers()) this.start();
    this.emit();
  }

  rename(name: string): void {
    const f = this.f;
    const n = name.trim().slice(0, NAME_MAX);
    if (!f || !n) return;
    f.name = n; this.save(); this.schedulePush(); this.emit();
  }

  setParts(parts: Parts): void {
    const f = this.f;
    if (!f) return;
    const turnedOn = (Object.keys(parts) as (keyof Parts)[]).some((p) => parts[p] && !f.parts[p]);
    f.parts = { ...parts };
    if (turnedOn) {
      // What the other computers already have now applies here too
      f.applied = Object.fromEntries(Object.entries(f.applied).filter(([key]) => {
        const r = [...f.own, ...Object.values(f.others).flatMap((o) => o.records)].find((x) => recordKey(x) === key);
        return !r || f.parts[recordPart(r)];
      }));
      this.applyWinners();
    }
    this.save(); this.schedulePush(); this.emit();
  }
}
