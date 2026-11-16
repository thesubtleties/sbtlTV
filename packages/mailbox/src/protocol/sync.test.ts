// packages/mailbox/src/protocol/sync.test.ts
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { newKeyPair } from './pairing.js';
import {
  BOX_PAD, deriveGroup, exportPrivate, keyPairFromPrivate, newDeviceId, openBox, openRekey, sealBox, sealRekey, tokenHash,
} from './sync.js';

describe('deriveGroup', () => {
  it('is deterministic and separates its outputs', () => {
    const K = randomBytes(32);
    const a = deriveGroup(K), b = deriveGroup(K);
    expect(a).toEqual(b);
    expect(a.groupId).toMatch(/^[0-9a-f]{32}$/);
    expect(a.accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.encKey.length).toBe(32);
    expect(deriveGroup(randomBytes(32)).groupId).not.toBe(a.groupId);
    expect(tokenHash(a.accessToken).length).toBe(32);
  });
});

describe('boxes', () => {
  const K = randomBytes(32);
  const { encKey, groupId } = deriveGroup(K);
  const did = newDeviceId();
  it('round-trips and pads to 16 KB steps', () => {
    const plain = Buffer.from(JSON.stringify({ hello: 'x'.repeat(100) }));
    const sealed = sealBox(encKey, groupId, did, plain);
    expect(sealed.length % BOX_PAD).toBe(0);
    expect(openBox(encKey, groupId, did, sealed)).toEqual(plain);
  });
  it('uses a fresh nonce each time', () => {
    const plain = Buffer.from('same');
    expect(sealBox(encKey, groupId, did, plain).equals(sealBox(encKey, groupId, did, plain))).toBe(false);
  });
  it('refuses a box moved to another computer or group, or tampered', () => {
    const sealed = sealBox(encKey, groupId, did, Buffer.from('x'));
    expect(() => openBox(encKey, groupId, newDeviceId(), sealed)).toThrow();
    expect(() => openBox(encKey, deriveGroup(randomBytes(32)).groupId, did, sealed)).toThrow();
    const bad = Buffer.from(sealed); bad[40] ^= 1;
    expect(() => openBox(encKey, groupId, did, bad)).toThrow();
  });
  it('a large box stays a whole number of steps', () => {
    const sealed = sealBox(encKey, groupId, did, randomBytes(40_000));
    expect(sealed.length % BOX_PAD).toBe(0);
  });
});

describe('rekey', () => {
  const oldK = randomBytes(32), newK = randomBytes(32);
  const { encKey: oldEnc, groupId: oldGid } = deriveGroup(oldK);
  const device = newKeyPair();
  const did = newDeviceId();
  it('opens for the computer it was sealed to', () => {
    const sealed = sealRekey(device.publicRaw, oldEnc, newK, oldGid, did);
    expect(openRekey(device, oldEnc, sealed, oldGid, did)).toEqual(newK);
  });
  it("can't be opened by another computer, for another id, or forged without the old key", () => {
    const sealed = sealRekey(device.publicRaw, oldEnc, newK, oldGid, did);
    expect(() => openRekey(newKeyPair(), oldEnc, sealed, oldGid, did)).toThrow();
    expect(() => openRekey(device, oldEnc, sealed, oldGid, newDeviceId())).toThrow();
    const forged = sealRekey(device.publicRaw, randomBytes(32), newK, oldGid, did);
    expect(() => openRekey(device, oldEnc, forged, oldGid, did)).toThrow();
  });
});

describe('device keys', () => {
  it('survive export and import', () => {
    const k = newKeyPair();
    const back = keyPairFromPrivate(exportPrivate(k));
    expect(back.publicRaw).toEqual(k.publicRaw);
  });
});
