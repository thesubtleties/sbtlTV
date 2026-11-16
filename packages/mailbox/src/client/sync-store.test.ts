// packages/mailbox/src/client/sync-store.test.ts
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { newKeyPair } from '../protocol/index.js';
import { DEFAULT_PARTS, KeyringUnavailable, SyncStore, type Sealer, type SyncFile } from './sync-store.js';

import { fakeSealer } from './sync-test-helpers.js';
const dir = () => mkdtempSync(join(tmpdir(), 'sync-store-'));

function file(store: SyncStore): SyncFile {
  const sealed = store.seal(randomBytes(32), newKeyPair());
  return { v: 1, status: 'active', ...sealed, deviceId: 'a'.repeat(32), pub: 'p', name: 'Mac', counter: 0, parts: { ...DEFAULT_PARTS }, own: [], others: {}, since: 0, lastSync: null, pendingUntil: null, applied: {}, epoch: null, previous: [], interrupted: [], removedIds: [] };
}

describe('SyncStore', () => {
  it('round-trips the file and the sealed secrets', () => {
    const p = join(dir(), 'sync-state.json');
    const s = new SyncStore(p, fakeSealer());
    const K = randomBytes(32), device = newKeyPair();
    const f = { ...file(s), ...s.seal(K, device) };
    s.save(f);
    const back = new SyncStore(p, fakeSealer()).load()!;
    expect(back).toEqual(f);
    const open = s.open(back);
    expect(open.K).toEqual(K);
    expect(open.device.publicRaw).toEqual(device.publicRaw);
    expect(readFileSync(p, 'utf8')).not.toContain(K.toString('base64'));
    expect(existsSync(`${p}.tmp`)).toBe(false);
    if (process.platform !== 'win32') expect(statSync(p).mode & 0o777).toBe(0o600);
  });

  it('is off when there is no file; an unreadable file is kept aside, not trusted', () => {
    const d = dir(); const p = join(d, 'sync-state.json');
    expect(new SyncStore(p, fakeSealer()).load()).toBeNull();
    writeFileSync(p, '{not json');
    expect(new SyncStore(p, fakeSealer()).load()).toBeNull();
    expect(existsSync(`${p}.bad`)).toBe(true);
  });

  it('refuses to seal or open without a keyring, and when the keyring changed', () => {
    const p = join(dir(), 'sync-state.json');
    expect(() => new SyncStore(p, fakeSealer(false)).seal(randomBytes(32), newKeyPair())).toThrow(KeyringUnavailable);
    const f = file(new SyncStore(p, fakeSealer()));
    expect(() => new SyncStore(p, fakeSealer(false)).open(f)).toThrow(KeyringUnavailable);
    const otherKeyring: Sealer = { available: () => true, seal: (x) => x, open: () => { throw new Error('cannot decrypt'); } };
    expect(() => new SyncStore(p, otherKeyring).open(f)).toThrow(KeyringUnavailable);
  });

  it('a file from before the epoch and previous fields loads with their defaults', () => {
    const p = join(dir(), 'sync-state.json');
    const s = new SyncStore(p, fakeSealer());
    const { epoch: _e, previous: _p, ...older } = file(s);
    writeFileSync(p, JSON.stringify(older));
    expect(s.load()).toMatchObject({ epoch: null, previous: [] });
  });

  it('clear removes the file', () => {
    const p = join(dir(), 'sync-state.json');
    const s = new SyncStore(p, fakeSealer());
    s.save(file(s)); s.clear();
    expect(existsSync(p)).toBe(false);
  });
});
