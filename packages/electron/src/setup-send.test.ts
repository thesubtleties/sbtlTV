import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendBody } from './setup-send.js';
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
