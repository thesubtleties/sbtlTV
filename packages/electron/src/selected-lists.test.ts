import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { isStale, listsInWindow, parseListsFile, readCache, verifyListsSignature, MAX_LISTS_BYTES, LISTS_PUBLIC_KEYS } from './selected-lists.js';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const PUB = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
const signed = (text: string) => sign(null, Buffer.from(text), privateKey).toString('base64');
const list = (o: Record<string, unknown> = {}) => ({ id: 'noir-nights', name: 'Noir nights', blurb: 'Rain and smoke.', items: [1, 2, 3, 4, 5, 6], ...o });
const file = (o: Record<string, unknown> = {}) => JSON.stringify({ v: 1, updated: '2026-11-08', movies: [list()], series: [], ...o });

test('the built-in public key is a real Ed25519 key', () => {
  assert.equal(LISTS_PUBLIC_KEYS.length >= 1, true);
  assert.match(LISTS_PUBLIC_KEYS[0]!, /^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=]+\n-----END PUBLIC KEY-----\n?$/);
});

test('signature: good, wrong key, one changed byte, garbage, rotation', () => {
  const body = file();
  assert.equal(verifyListsSignature(Buffer.from(body), signed(body), [PUB]), true);
  assert.equal(verifyListsSignature(Buffer.from(body), signed(body), [other]), false);
  assert.equal(verifyListsSignature(Buffer.from(body.replace('"v":1', '"v": 1')), signed(body), [PUB]), false);
  assert.equal(verifyListsSignature(Buffer.from(body), 'not base64!', [PUB]), false);
  assert.equal(verifyListsSignature(Buffer.from(body), '', [PUB]), false);
  assert.equal(verifyListsSignature(Buffer.from(body), signed(body), [other, PUB]), true);
});

test('parse: good file; unknown sections and fields ignored', () => {
  const lists = parseListsFile(file({ sports: [{ x: 1 }], movies: [list({ art: 'https://x' })] }))!;
  assert.deepEqual(lists.movies[0], { id: 'noir-nights', name: 'Noir nights', blurb: 'Rain and smoke.', items: [1, 2, 3, 4, 5, 6] });
  assert.deepEqual(lists.series, []);
});

test('parse: rejects bad files (whole file or nothing)', () => {
  const bad = ['', 'nope', '[]', file({ v: 2 }), file({ updated: 'x' }), file({ movies: [list({ items: [1.5] })] }),
    file({ movies: [list({ items: [] })] }), file({ movies: [list({ items: [1, 1] })] }), file({ movies: [list({ items: ['3'] })] }),
    file({ movies: [list({ blurb: 'see www.x.com' })] }), file({ movies: [list({ name: 'x'.repeat(41) })] }), file({ movies: [list({ name: '  ' })] }),
    file({ movies: [list(), list()] }), file({ series: [list()] , movies: [list()] }), file({ movies: [list({ id: 'Bad!' })] }),
    file({ movies: [list({ from: '2026-13-01' })] }), file({ movies: [list({ from: '2026-11-09', until: '2026-11-08' })] }),
    file({ movies: Array.from({ length: 51 }, (_, i) => list({ id: `l${i}` })) }),
    file({ movies: [list({ items: Array.from({ length: 101 }, (_, i) => i + 1) })] }), file({ movies: {} })];
  for (const b of bad) assert.equal(parseListsFile(b), null, b.slice(0, 90));
  assert.equal(parseListsFile(' '.repeat(MAX_LISTS_BYTES + 1)), null);
});

test('window: from inclusive, until exclusive, by local date', () => {
  const l = parseListsFile(file({ movies: [list({ id: 'a', from: '2026-11-08', until: '2026-11-09' }), list({ id: 'b', until: '2026-11-08' }), list({ id: 'c', from: '2026-11-09' }), list({ id: 'd' })] }))!;
  assert.deepEqual(listsInWindow(l, '2026-11-08').movies.map((x) => x.id), ['a', 'd']);
});

test('stale after 24 h, or when never fetched', () => {
  assert.equal(isStale(undefined, 1000), true);
  assert.equal(isStale(0, 24 * 3600 * 1000 - 1), false);
  assert.equal(isStale(0, 24 * 3600 * 1000), true);
  assert.equal(isStale(10_000, 5_000), true, 'saved with a clock that ran ahead');
});

test('cache: good one loads; tampered, unsigned, malformed or unknown-key cache is rejected', () => {
  const body = file();
  const good = { etag: '"e1"', fetchedAt: 5, body, sig: signed(body) };
  assert.equal(readCache(good, [PUB])?.lists.movies.length, 1);
  assert.equal(readCache({ ...good, etag: null }, [PUB])?.cache.etag, null);
  assert.equal(readCache({ ...good, body: body.replace('Noir', 'Nior') }, [PUB]), null);
  assert.equal(readCache({ ...good, sig: '' }, [PUB]), null);
  assert.equal(readCache(good, [other]), null);
  assert.equal(readCache(null, [PUB]), null);
  assert.equal(readCache({ ...good, fetchedAt: 'x' }, [PUB]), null);
  assert.equal(readCache({ ...good, etag: 3 }, [PUB]), null);
});
