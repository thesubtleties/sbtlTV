import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SetupFileError, openWithKeyring, openWithPassphrase, readHeader, sealWithKeyring, sealWithPassphrase, type KeyProtector,
} from './setup-file.js';

const FAST_N = 1024; // tests only; real files use 131072
const body = { app: '0.13.1', sources: [{ id: 's1', name: 'One' }] };
const fakeKeyring: KeyProtector = {
  protect: (key) => Buffer.from(key).reverse().toString('base64'),
  unprotect: (sealed) => Buffer.from(sealed, 'base64').reverse(),
};
const otherKeyring: KeyProtector = { protect: fakeKeyring.protect, unprotect: () => { throw new Error('cannot decrypt'); } };

async function rejects(p: Promise<unknown> | (() => unknown), reason: string) {
  await assert.rejects(async () => (typeof p === 'function' ? p() : p), (e) => e instanceof SetupFileError && e.reason === reason);
}

test('a passphrase file round-trips and starts with a readable header line', async () => {
  const file = await sealWithPassphrase(body, 'abacus-abdomen-abide-acorn-actor', FAST_N);
  const firstLine = file.subarray(0, file.indexOf(0x0a)).toString('utf8');
  const header = JSON.parse(firstLine);
  assert.equal(header.format, 'sbtltv-setup');
  assert.equal(header.version, 1);
  assert.deepEqual(header.kdf, { name: 'scrypt', N: FAST_N, r: 8, p: 1 });
  assert.deepEqual(await openWithPassphrase(file, 'abacus-abdomen-abide-acorn-actor'), body);
});

test('the default cost is N=131072, r=8, p=1', async () => {
  const file = await sealWithPassphrase(body, 'abacus-abdomen-abide-acorn-actor');
  assert.deepEqual(readHeader(file).kdf, { name: 'scrypt', N: 131072, r: 8, p: 1 });
});

test('a wrong passphrase, a changed body byte or a changed header byte is rejected', async () => {
  const file = await sealWithPassphrase(body, 'abacus-abdomen-abide-acorn-actor', FAST_N);
  await rejects(openWithPassphrase(file, 'abacus-abdomen-abide-acorn-actress'), 'wrong-passphrase');
  const flipped = Buffer.from(file); flipped[flipped.length - 20] ^= 1;
  await rejects(openWithPassphrase(flipped, 'abacus-abdomen-abide-acorn-actor'), 'wrong-passphrase');
  const nl = file.indexOf(0x0a);
  const header = JSON.parse(file.subarray(0, nl).toString('utf8'));
  header.nonce = Buffer.alloc(12, 7).toString('base64');
  const edited = Buffer.concat([Buffer.from(JSON.stringify(header)), file.subarray(nl)]);
  await rejects(openWithPassphrase(edited, 'abacus-abdomen-abide-acorn-actor'), 'wrong-passphrase');
});

test('broken files are invalid, newer versions are refused', async () => {
  await rejects(openWithPassphrase(Buffer.from('not a setup'), 'x'), 'invalid');
  await rejects(openWithPassphrase(Buffer.from('{"format":"sbtltv-setup"}'), 'x'), 'invalid'); // no newline
  await rejects(openWithPassphrase(Buffer.from('{"format":"other","version":1}\nxx'), 'x'), 'invalid');
  await rejects(openWithPassphrase(Buffer.from('{"format":"sbtltv-setup","version":1,"kdf":{"name":"scrypt","N":1e12,"r":8,"p":1},"salt":"AA==","nonce":"AA=="}\nxx'), 'x'), 'invalid'); // absurd cost
  const file = await sealWithPassphrase(body, 'p', FAST_N);
  const nl = file.indexOf(0x0a);
  const header = JSON.parse(file.subarray(0, nl).toString('utf8'));
  header.version = 2;
  await rejects(openWithPassphrase(Buffer.concat([Buffer.from(JSON.stringify(header)), file.subarray(nl)]), 'p'), 'newer');
  await rejects(openWithPassphrase(file.subarray(0, nl + 10), 'p'), 'invalid'); // truncated: shorter than a tag
});

test('a keyring backup opens only where its key can be unsealed', async () => {
  const file = sealWithKeyring(body, fakeKeyring);
  assert.equal(readHeader(file).kdf.name, 'keyring');
  assert.deepEqual(openWithKeyring(file, fakeKeyring), body);
  await rejects(() => openWithKeyring(file, otherKeyring), 'other-computer');
  await rejects(openWithPassphrase(file, 'p'), 'needs-keyring');
  await rejects(async () => openWithKeyring(await sealWithPassphrase(body, 'p', FAST_N), fakeKeyring), 'needs-passphrase');
});

// ---- review 8 (tests lens): kill tests ----
import { createCipheriv, randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';

/** A keyring file built by hand around raw gzip bytes (fakeKeyring), to test what unseal does with them. */
function keyringFileAround(packed: Buffer): Buffer {
  const key = randomBytes(32);
  const header = Buffer.from(JSON.stringify({ format: 'sbtltv-setup', version: 1, kdf: { name: 'keyring' }, key: fakeKeyring.protect(key), nonce: randomBytes(12).toString('base64') }));
  const c = createCipheriv('aes-256-gcm', key, Buffer.from(JSON.parse(header.toString()).nonce, 'base64'));
  c.setAAD(header);
  return Buffer.concat([header, Buffer.from('\n'), c.update(packed), c.final(), c.getAuthTag()]);
}

test('R8: any edit to the header line is caught, not only the fields the key depends on', async () => {
  const file = await sealWithPassphrase(body, 'p', FAST_N);
  const nl = file.indexOf(0x0a);
  const respaced = JSON.stringify(JSON.parse(file.subarray(0, nl).toString('utf8')), null, 1).replace(/\n/g, ' ');
  await rejects(openWithPassphrase(Buffer.concat([Buffer.from(respaced), file.subarray(nl)]), 'p'), 'wrong-passphrase');
});

test('R8: every file gets its own salt and nonce', async () => {
  const a = readHeader(await sealWithPassphrase(body, 'p', FAST_N));
  const b = readHeader(await sealWithPassphrase(body, 'p', FAST_N));
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.nonce, b.nonce);
  assert.notEqual(readHeader(sealWithKeyring(body, fakeKeyring)).nonce, readHeader(sealWithKeyring(body, fakeKeyring)).nonce);
});

test('R8: each header bound refuses on its own', async () => {
  const file = (h: Record<string, unknown>) => Buffer.from(JSON.stringify({ format: 'sbtltv-setup', version: 1, salt: Buffer.alloc(16).toString('base64'), nonce: Buffer.alloc(12).toString('base64'), ...h }) + '\n' + 'x'.repeat(32));
  const scrypt = (o: object) => ({ kdf: { name: 'scrypt', N: 1024, r: 8, p: 1, ...o } });
  for (const h of [scrypt({ N: 1 << 21 }), scrypt({ N: 3000 }), scrypt({ r: 17 }), scrypt({ p: 5 }), scrypt({ r: 0 }), { ...scrypt({}), salt: 'AA==' },
    { ...scrypt({}), nonce: Buffer.alloc(16).toString('base64') }, { kdf: { name: 'none' } }, {}]) {
    await rejects(openWithPassphrase(file(h), 'p'), 'invalid');
  }
  await rejects(openWithPassphrase(file({ ...scrypt({}), pad: 'x'.repeat(5000) }), 'p'), 'invalid'); // header over 4 KB
});

test('R8: a body that unpacks past the cap is refused (gzip bomb)', async () => {
  const mb = gzipSync(Buffer.alloc(1 << 20, 0x20));       // 1 MB of spaces, ~1 KB packed
  const members = [gzipSync(Buffer.from('[')), ...Array(257).fill(mb), gzipSync(Buffer.from(']'))];  // gunzip reads concatenated members
  await rejects(() => openWithKeyring(keyringFileAround(Buffer.concat(members)), fakeKeyring), 'invalid');
});

test('R8: a changed byte in a backup says other-computer, like a foreign key', async () => {
  const file = sealWithKeyring(body, fakeKeyring);
  const flipped = Buffer.from(file); flipped[flipped.length - 20] ^= 1;
  await rejects(() => openWithKeyring(flipped, fakeKeyring), 'other-computer');
});
