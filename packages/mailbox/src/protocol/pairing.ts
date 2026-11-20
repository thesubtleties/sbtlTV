/**
 * The knock's crypto. The receiver commits to its key (hash) before it sees the giver's, so a man
 * in the middle (even our own server) can't search keys until the three words match.
 * Node built-ins only: X25519, HKDF-SHA256, AES-256-GCM.
 */
import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, timingSafeEqual, type KeyObject } from 'node:crypto';

export interface KeyPair { privateKey: KeyObject; publicRaw: Buffer }

// DER prefix of an X25519 SubjectPublicKeyInfo; the raw key is the last 32 bytes
const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');

export function newKeyPair(): KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('x25519');
  const der = publicKey.export({ format: 'der', type: 'spki' });
  return { privateKey, publicRaw: Buffer.from(der.subarray(der.length - 32)) };
}

function publicFromRaw(raw: Buffer): KeyObject {
  if (raw.length !== 32) throw new Error('bad key');
  return createPublicKey({ key: Buffer.concat([X25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
}

const sha256 = (...parts: Buffer[]) => createHash('sha256').update(Buffer.concat(parts)).digest();

export function newReceiverSecret(): { keys: KeyPair; r: Buffer; commitment: Buffer } {
  const keys = newKeyPair();
  const r = randomBytes(16);
  return { keys, r, commitment: sha256(keys.publicRaw, r) };
}

export function checkReveal(commitment: Buffer, receiverPub: Buffer, r: Buffer): boolean {
  if (commitment.length !== 32 || receiverPub.length !== 32 || r.length !== 16) return false;
  return timingSafeEqual(commitment, sha256(receiverPub, r));
}

/**
 * Three words from 16-bit chunks mod list length. With the EFF list (7772 words) some words are
 * about 12 % likelier than others; a man in the middle's chance of matching all three stays
 * around 1 in 400 billion, and the commitment means it gets one try.
 */
export function knockWords(commitment: Buffer, giverPub: Buffer, receiverPub: Buffer, wordlist: readonly string[]): [string, string, string] {
  const bytes = Buffer.from(hkdfSync('sha256', sha256(commitment, giverPub, receiverPub), Buffer.alloc(0), 'sbtl-sas', 6));
  const pick = (i: number) => wordlist[bytes.readUInt16BE(i * 2) % wordlist.length];
  return [pick(0), pick(1), pick(2)];
}

/** HKDF over an X25519 shared secret (the knock's drop key and sync's rekey both use it). */
export function x25519Key(mine: KeyPair, theirPub: Buffer, salt: Buffer, info: string): Buffer {
  const shared = diffieHellman({ privateKey: mine.privateKey, publicKey: publicFromRaw(theirPub) });
  return Buffer.from(hkdfSync('sha256', shared, salt, info, 32));
}

export function dropKey(mine: KeyPair, theirPub: Buffer, commitment: Buffer): Buffer {
  return x25519Key(mine, theirPub, commitment, 'sbtl-drop');
}

/** A long-term key kept by the app (sealed by the OS keyring): PKCS#8 DER out and back in. */
export function exportPrivate(k: KeyPair): Buffer {
  return k.privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer;
}
export function keyPairFromPrivate(der: Buffer): KeyPair {
  const privateKey = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  const pub = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  return { privateKey, publicRaw: Buffer.from(pub.subarray(pub.length - 32)) };
}

/** AES-256-GCM: 12-byte nonce in front, 16-byte tag at the end */
export const SEAL_OVERHEAD = 12 + 16;

export function seal(key: Buffer, plaintext: Buffer, aad: Buffer): Buffer {
  const nonce = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, nonce);
  c.setAAD(aad);
  const body = Buffer.concat([c.update(plaintext), c.final()]);
  return Buffer.concat([nonce, body, c.getAuthTag()]);
}

export function open(key: Buffer, sealed: Buffer, aad: Buffer): Buffer {
  if (sealed.length < SEAL_OVERHEAD) throw new Error('sealed too short');
  const d = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12));
  d.setAAD(aad);
  d.setAuthTag(sealed.subarray(sealed.length - 16));
  return Buffer.concat([d.update(sealed.subarray(12, sealed.length - 16)), d.final()]);
}

/** Additional data for a drop: the knock's commitment (its bytes), which both sides know. */
export const dropAad = (commitment: Buffer) => Buffer.concat([Buffer.from('sbtl-drop|'), commitment]);

/**
 * Base64 from the relay, strictly: canonical (re-encodes to the same text) and, when given, exactly
 * `bytes` long. Anything else throws, so a relay can't vary encodings to break a knock late.
 */
export function decodeB64(text: unknown, bytes?: number): Buffer {
  if (typeof text !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Error('bad base64');
  const b = Buffer.from(text, 'base64');
  if (b.toString('base64') !== text || (bytes !== undefined && b.length !== bytes)) throw new Error('bad base64');
  return b;
}
