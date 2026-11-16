import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { MAX_RECEIVED_BYTES, fitsInDrop, packSetup, receivedChanges, unpackSetup, sendBody } from './setup-send.js';
import { validateSetupBody, type SetupBody } from './setup-body.js';

const base: SetupBody = {
  app: '0.17.0', exportedAt: '2026-11-15T00:00:00Z', platform: 'linux', includes: ['sources', 'logins'],
  sources: [
    { id: 'a', name: 'Mine', type: 'xtream', url: 'http://a.example', username: 'u', password: 'p', enabled: true },
    { id: 'b', name: 'Other', type: 'm3u', url: 'http://b.example/list.m3u', enabled: true },
  ],
};
let n = 0;
const newId = () => `new-${++n}`;

test('picked sources only; just-for-this-send sources added with fresh ids and enabled', () => {
  const out = sendBody(base, { parts: ['sources', 'logins'], sourceIds: ['b'], extras: { sources: [{ name: 'Grandma IPTV', type: 'xtream', url: 'http://g.example', username: 'gran', password: 'pw' }], apiKeys: {} } }, newId);
  assert.deepEqual(out.sources?.map((s) => s.name), ['Other', 'Grandma IPTV']);
  assert.equal(out.sources?.[1].enabled, true);
  assert.match(out.sources![1].id, /^new-/);
  assert.equal(out.sources?.[1].password, 'pw');
  validateSetupBody(out); // what we send is what the receiver accepts
});

test("keys entered for them replace and add to the sender's chosen keys", () => {
  const withKeys: SetupBody = { ...base, includes: ['apiKeys'], apiKeys: { tmdb: 'mine', subdl: 'mine-subdl' } };
  const out = sendBody(withKeys, { parts: ['apiKeys'], sourceIds: null, extras: { sources: [], apiKeys: { tmdb: 'grandmas' } } }, newId);
  assert.deepEqual(out.apiKeys, { tmdb: 'grandmas', subdl: 'mine-subdl' });
});

test('extras alone count as parts so the receiver applies them', () => {
  const out = sendBody({ ...base, includes: [], sources: undefined }, { parts: [], sourceIds: null, extras: { sources: [{ name: 'G', type: 'm3u', url: 'http://g.example/x.m3u' }], apiKeys: { tmdb: 'k' } } }, newId);
  assert.ok(out.includes.includes('sources'));
  assert.ok(out.includes.includes('apiKeys'));
  validateSetupBody(out);
});

test('a just-for-this-send login travels even without the logins part', () => {
  const out = sendBody({ ...base, includes: [], sources: undefined }, { parts: [], sourceIds: null, extras: { sources: [{ name: 'G', type: 'xtream', url: 'http://g.example', username: 'g', password: 'pw' }], apiKeys: {} } }, newId);
  assert.ok(out.includes.includes('logins'));
  assert.equal(out.sources?.[0].password, 'pw');
});

test('a received setup unpacks only within its size limit (no zip bomb)', () => {
  const body = sendBody(base, { parts: ['sources'], sourceIds: null, extras: { sources: [], apiKeys: {} } }, newId);
  assert.deepEqual(unpackSetup(packSetup(body)), validateSetupBody(body));
  const bomb = gzipSync(Buffer.alloc(MAX_RECEIVED_BYTES + 1, 32));
  assert.ok(bomb.length < 1024 * 1024);
  assert.throws(() => unpackSetup(bomb));
  assert.throws(() => unpackSetup(Buffer.from('not gzip')));
});

test('too big to send is known before anyone rings', () => {
  assert.equal(fitsInDrop(Buffer.alloc(1024)), true);
  assert.equal(fitsInDrop(Buffer.alloc(2 * 1024 * 1024 - 28)), true);    // sealing adds 28 bytes
  assert.equal(fitsInDrop(Buffer.alloc(2 * 1024 * 1024 - 27)), false);
});

test('no source picked and none added: no sources part, so the preview does not promise any', () => {
  const out = sendBody(base, { parts: ['sources', 'logins'], sourceIds: [], extras: { sources: [], apiKeys: {} } }, newId);
  assert.equal(out.sources, undefined);
  assert.ok(!out.includes.includes('sources'));
  validateSetupBody(out);
});

test('a key field left empty for them does not blank the sender\'s chosen key', () => {
  const withKeys: SetupBody = { ...base, includes: ['apiKeys'], apiKeys: { tmdb: 'mine' } };
  const out = sendBody(withKeys, { parts: ['apiKeys'], sourceIds: null, extras: { sources: [], apiKeys: { tmdb: '', subdl: '' } } }, newId);
  assert.deepEqual(out.apiKeys, { tmdb: 'mine' });
});

test('a just-for-this-send source without a password does not add the logins part', () => {
  const out = sendBody({ ...base, includes: [], sources: undefined }, { parts: [], sourceIds: null, extras: { sources: [{ name: 'G', type: 'm3u', url: 'http://g.example/x.m3u' }], apiKeys: {} } }, newId);
  assert.ok(!out.includes.includes('logins'));
});

test('providers added just for this send are tidied: trimmed, M3U without login fields, Xtream needs both', () => {
  const out = sendBody({ ...base, includes: [], sources: undefined }, { parts: [], sourceIds: null, extras: { sources: [
    { name: '  Gran  ', type: 'xtream', url: ' http://g.example ', username: ' gran ', password: 'pw ' },
    { name: 'List', type: 'm3u', url: 'http://g.example/x.m3u', username: 'left over', password: 'from xtream' },
  ], apiKeys: { tmdb: '  k  ' } } }, newId);
  assert.deepEqual(out.sources?.map((s) => [s.name, s.url, s.username, s.password]), [['Gran', 'http://g.example', 'gran', 'pw'], ['List', 'http://g.example/x.m3u', undefined, undefined]]);
  assert.equal(out.apiKeys?.tmdb, 'k');
  assert.throws(() => sendBody({ ...base, includes: [], sources: undefined }, { parts: [], sourceIds: null, extras: { sources: [{ name: 'X', type: 'xtream', url: 'http://x.example', username: 'u' }], apiKeys: {} } }, newId), /login/);
});

test('a received setup changes only what it carries', () => {
  assert.deepEqual(receivedChanges({ ...base, includes: ['apiKeys'], sources: undefined, apiKeys: { tmdb: 'k' } }), { sources: false, settings: false, apiKeys: ['tmdb'] });
  assert.deepEqual(receivedChanges({ ...base, includes: ['sources', 'logins', 'settings'], settings: {} }), { sources: true, settings: true, apiKeys: [] });
});
