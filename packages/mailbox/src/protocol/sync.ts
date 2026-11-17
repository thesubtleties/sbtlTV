// packages/mailbox/src/protocol/sync.ts
/**
 * Sync's crypto. A group key K (32 random bytes, only on the computers) gives the group's address,
 * its access token (the relay keeps only a hash) and the box key. Each computer's data is one box:
 * gzip, padded to 16 KB steps, AES-256-GCM bound to group + computer + format, so the relay can't
 * move a box. Removing a computer seals a new key to each remaining computer's long-term key.
 */
import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { SEAL_OVERHEAD, newKeyPair, open, seal, x25519Key, type KeyPair } from './pairing.js';

export { exportPrivate, keyPairFromPrivate } from './pairing.js';

export const BOX_PAD = 16 * 1024;
/** Sealed box size limit (the relay refuses bigger); a heavy profile is a few hundred KB before gzip */
export const MAX_BOX_BYTES = 1024 * 1024;
export const MAX_COMPUTERS = 10;
export const BOX_FORMAT = 1;
export const GROUP_IDLE_DAYS = 90;
/** A remaining computer's new key as sealRekey makes it: ephemeral public key + sealed (new key, MAC) */
export const REKEY_BYTES = 32 + SEAL_OVERHEAD + 64;
const MAX_PLAIN_BYTES = 16 * 1024 * 1024;

const hk = (K: Buffer, info: string, bytes: number) => Buffer.from(hkdfSync('sha256', K, Buffer.alloc(0), info, bytes));

export function deriveGroup(K: Buffer): { encKey: Buffer; macKey: Buffer; groupId: string; accessToken: string } {
  if (K.length !== 32) throw new Error('bad group key');
  return {
    encKey: hk(K, 'sbtl-sync-enc', 32),
    /** Proves a rekey came from someone holding this group's key (its own key, not the box key) */
    macKey: hk(K, 'sbtl-sync-rekey-mac', 32),
    groupId: hk(K, 'sbtl-sync-group', 16).toString('hex'),
    accessToken: hk(K, 'sbtl-sync-token', 32).toString('base64url'),
  };
}

export const tokenHash = (accessToken: string) => createHash('sha256').update(accessToken).digest();
export const newDeviceId = () => randomBytes(16).toString('hex');

const boxAad = (groupId: string, deviceId: string) => Buffer.from(`sbtl-box|${groupId}|${deviceId}|${BOX_FORMAT}`);

export function sealBox(encKey: Buffer, groupId: string, deviceId: string, plaintext: Buffer): Buffer {
  const gz = gzipSync(plaintext);
  const framed = 4 + gz.length;
  const total = Math.ceil((framed + SEAL_OVERHEAD) / BOX_PAD) * BOX_PAD - SEAL_OVERHEAD;
  const padded = Buffer.alloc(total);
  padded.writeUInt32BE(gz.length, 0);
  gz.copy(padded, 4);
  return seal(encKey, padded, boxAad(groupId, deviceId));
}

export function openBox(encKey: Buffer, groupId: string, deviceId: string, sealed: Buffer): Buffer {
  const padded = open(encKey, sealed, boxAad(groupId, deviceId));
  const len = padded.readUInt32BE(0);
  if (len + 4 > padded.length) throw new Error('bad box');
  return gunzipSync(padded.subarray(4, 4 + len), { maxOutputLength: MAX_PLAIN_BYTES });
}

/**
 * A remaining computer's proof that it opened its new key (only the new key gives it). The relay
 * stores the hash, and counts a key as picked up only on this proof: a removed computer holding just
 * the old key can't mark keys picked up to get a moved group deleted early.
 */
export const ackProof = (newK: Buffer, deviceId: string) => hk(newK, `sbtl-rekey-ack|${deviceId}`, 32);
export const ackHash = (proof: Buffer) => createHash('sha256').update(proof).digest();

const rekeyAad = (oldGroupId: string, deviceId: string) => Buffer.from(`sbtl-rekey|${oldGroupId}|${deviceId}`);
const rekeyMac = (oldMacKey: Buffer, newK: Buffer) => createHmac('sha256', oldMacKey).update('sbtl-rekey').update(newK).digest();

/** The new group key for one remaining computer: ephemeral X25519 to its long-term key, plus proof the sender held the old key. */
export function sealRekey(devicePub: Buffer, oldMacKey: Buffer, newK: Buffer, oldGroupId: string, deviceId: string): Buffer {
  const eph = newKeyPair();
  const key = x25519Key(eph, devicePub, Buffer.concat([eph.publicRaw, devicePub]), 'sbtl-rekey');
  const inner = Buffer.concat([newK, rekeyMac(oldMacKey, newK)]);
  return Buffer.concat([eph.publicRaw, seal(key, inner, rekeyAad(oldGroupId, deviceId))]);
}

export function openRekey(device: KeyPair, oldMacKey: Buffer, sealed: Buffer, oldGroupId: string, deviceId: string): Buffer {
  if (sealed.length < REKEY_BYTES) throw new Error('bad rekey');
  const ephPub = sealed.subarray(0, 32);
  const key = x25519Key(device, ephPub, Buffer.concat([ephPub, device.publicRaw]), 'sbtl-rekey');
  const inner = open(key, sealed.subarray(32), rekeyAad(oldGroupId, deviceId));
  if (inner.length !== 64) throw new Error('bad rekey');
  const newK = inner.subarray(0, 32);
  if (!timingSafeEqual(inner.subarray(32), rekeyMac(oldMacKey, newK))) throw new Error('bad rekey');
  return Buffer.from(newK);
}
