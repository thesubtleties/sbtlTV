/**
 * The .sbtltv setup file: one readable JSON header line, then gzip(JSON) sealed
 * with AES-256-GCM (the header line is the additional data, so it cannot be edited
 * either). The key comes from a passphrase (scrypt) or, for local backups, is a
 * random key sealed by the system keyring (KeyProtector). Pure: no Electron.
 */
import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb, type ScryptOptions } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

export const SETUP_FORMAT = 'sbtltv-setup';
export const SETUP_VERSION = 1;
const SCRYPT = { N: 131072, r: 8, p: 1 };
const MAX_HEADER_BYTES = 4096;
export const MAX_BODY_BYTES = 256 * 1024 * 1024;
const TAG_BYTES = 16;

export type SetupHeader = {
  format: typeof SETUP_FORMAT;
  version: number;
  kdf: { name: 'scrypt'; N: number; r: number; p: number } | { name: 'keyring' };
  salt?: string;
  nonce: string;
  key?: string;
};

export interface KeyProtector { protect(key: Buffer): string; unprotect(sealed: string): Buffer }

export type SetupFileProblem = 'invalid' | 'newer' | 'wrong-passphrase' | 'other-computer' | 'needs-passphrase' | 'needs-keyring';
export class SetupFileError extends Error {
  constructor(public readonly reason: SetupFileProblem) { super(reason); this.name = 'SetupFileError'; }
}

function scrypt(passphrase: string, salt: Buffer, o: { N: number; r: number; p: number }): Promise<Buffer> {
  const options: ScryptOptions = { N: o.N, r: o.r, p: o.p, maxmem: 256 * 1024 * 1024 };
  return new Promise((resolve, reject) => scryptCb(passphrase, salt, 32, options, (e, key) => (e ? reject(e) : resolve(key))));
}

function seal(header: SetupHeader, key: Buffer, body: unknown): Buffer {
  const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
  const cipher = createCipheriv('aes-256-gcm', key, Buffer.from(header.nonce, 'base64'));
  cipher.setAAD(headerBytes);
  const sealed = Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(body), 'utf8'))), cipher.final(), cipher.getAuthTag()]);
  return Buffer.concat([headerBytes, Buffer.from('\n'), sealed]);
}

function split(file: Buffer): { headerBytes: Buffer; header: SetupHeader; sealed: Buffer } {
  const nl = file.indexOf(0x0a);
  if (nl <= 0 || nl > MAX_HEADER_BYTES) throw new SetupFileError('invalid');
  const headerBytes = file.subarray(0, nl);
  let raw: unknown;
  try { raw = JSON.parse(headerBytes.toString('utf8')); } catch { throw new SetupFileError('invalid'); }
  const h = raw as Partial<SetupHeader> & Record<string, unknown>;
  if (!h || typeof h !== 'object' || h.format !== SETUP_FORMAT || typeof h.version !== 'number' || !Number.isInteger(h.version)) throw new SetupFileError('invalid');
  if (h.version > SETUP_VERSION) throw new SetupFileError('newer');
  if (typeof h.nonce !== 'string' || Buffer.from(h.nonce, 'base64').length !== 12) throw new SetupFileError('invalid');
  const kdf = h.kdf as SetupHeader['kdf'] | undefined;
  if (kdf?.name === 'scrypt') {
    // Bound the cost a file can ask for: a hostile file must not pin memory or CPU.
    const ok = [kdf.N, kdf.r, kdf.p].every(Number.isInteger) && kdf.N >= 1024 && kdf.N <= 1 << 20 && (kdf.N & (kdf.N - 1)) === 0 && kdf.r >= 1 && kdf.r <= 16 && kdf.p >= 1 && kdf.p <= 4;
    if (!ok || typeof h.salt !== 'string' || Buffer.from(h.salt, 'base64').length < 16) throw new SetupFileError('invalid');
  } else if (kdf?.name === 'keyring') {
    if (typeof h.key !== 'string' || !h.key) throw new SetupFileError('invalid');
  } else {
    throw new SetupFileError('invalid');
  }
  const sealed = file.subarray(nl + 1);
  if (sealed.length <= TAG_BYTES) throw new SetupFileError('invalid');
  return { headerBytes, header: h as SetupHeader, sealed };
}

function unseal(headerBytes: Buffer, header: SetupHeader, sealed: Buffer, key: Buffer, onAuthFail: SetupFileProblem): unknown {
  let packed: Buffer;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(header.nonce, 'base64'));
    decipher.setAAD(headerBytes);
    decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
    packed = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)), decipher.final()]);
  } catch {
    throw new SetupFileError(onAuthFail);
  }
  try {
    return JSON.parse(gunzipSync(packed, { maxOutputLength: MAX_BODY_BYTES }).toString('utf8'));
  } catch {
    throw new SetupFileError('invalid');
  }
}

export function readHeader(file: Buffer): SetupHeader {
  return split(file).header;
}

export async function sealWithPassphrase(body: unknown, passphrase: string, scryptN = SCRYPT.N): Promise<Buffer> {
  const salt = randomBytes(16);
  const kdf = { name: 'scrypt' as const, N: scryptN, r: SCRYPT.r, p: SCRYPT.p };
  const key = await scrypt(passphrase, salt, kdf);
  return seal({ format: SETUP_FORMAT, version: SETUP_VERSION, kdf, salt: salt.toString('base64'), nonce: randomBytes(12).toString('base64') }, key, body);
}

export function sealWithKeyring(body: unknown, keys: KeyProtector): Buffer {
  const key = randomBytes(32);
  return seal({ format: SETUP_FORMAT, version: SETUP_VERSION, kdf: { name: 'keyring' }, key: keys.protect(key), nonce: randomBytes(12).toString('base64') }, key, body);
}

export async function openWithPassphrase(file: Buffer, passphrase: string): Promise<unknown> {
  const { headerBytes, header, sealed } = split(file);
  if (header.kdf.name !== 'scrypt') throw new SetupFileError('needs-keyring');
  const key = await scrypt(passphrase, Buffer.from(header.salt!, 'base64'), header.kdf);
  return unseal(headerBytes, header, sealed, key, 'wrong-passphrase');
}

export function openWithKeyring(file: Buffer, keys: KeyProtector): unknown {
  const { headerBytes, header, sealed } = split(file);
  if (header.kdf.name !== 'keyring') throw new SetupFileError('needs-passphrase');
  let key: Buffer;
  try { key = keys.unprotect(header.key!); } catch { throw new SetupFileError('other-computer'); }
  if (key.length !== 32) throw new SetupFileError('other-computer');
  // The key unsealed, so this computer made it: a failing tag means the file was changed or cut short.
  return unseal(headerBytes, header, sealed, key, 'invalid');
}
