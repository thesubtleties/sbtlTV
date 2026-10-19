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
