import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rankResults } from './subtitle-pick.js';
import type { SubdlResult } from './subdl-client.js';

const r = (o: Partial<SubdlResult>): SubdlResult => ({ nId: 'x', releaseName: 'R', language: 'en', hi: false, ai: false, author: null, season: null, episode: null, pack: false, popularity: null, fps: null, md5: null, ...o });

test('language first, then standard vs SDH by preference, then human over AI, then popularity, else SubDL order', () => {
  const list = [r({ nId: 'ai', ai: true, popularity: 900 }), r({ nId: 'sdh', hi: true }), r({ nId: 'fr', language: 'fr' }), r({ nId: 'pop', popularity: 50 }), r({ nId: 'plain' })];
  assert.deepEqual(rankResults(list, { language: 'en', preferSdh: false }).map((x) => x.nId), ['pop', 'plain', 'sdh', 'ai', 'fr']);
  assert.equal(rankResults(list, { language: 'en', preferSdh: true })[0].nId, 'sdh');
});

test('settings code vs SubDL code: pt-br matches br_pt', () => {
  const list = [r({ nId: 'pt', language: 'pt' }), r({ nId: 'br', language: 'br_pt' })];
  assert.equal(rankResults(list, { language: 'pt-br', preferSdh: false })[0].nId, 'br');
});

test('episodes: only the wanted episode file (from a pack or not); single-episode uploads first', () => {
  const list = [r({ nId: 'e13', season: 5, episode: 13 }), r({ nId: 'pack14', season: 5, episode: 14, pack: true }), r({ nId: 'e14', season: 5, episode: 14 }), r({ nId: 's0e14', season: null, episode: 14, pack: true }), r({ nId: 's4e14', season: 4, episode: 14 })];
  assert.deepEqual(rankResults(list, { language: 'en', preferSdh: false, season: 5, episode: 14 }).map((x) => x.nId), ['e14', 'pack14', 's0e14']);
});
