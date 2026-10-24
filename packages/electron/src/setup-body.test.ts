import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SETUP_SETTING_KEYS, buildSetupBody, describeSetup, explainExportProblem, keptOnImport, settingsForExport, validateSetupBody } from './setup-body.js';

const good = () => ({
  app: '0.13.1', exportedAt: '2026-10-19T12:00:00.000Z', platform: 'linux',
  includes: ['sources', 'logins', 'settings', 'apiKeys', 'favorites'],
  sources: [
    { id: 'a1', name: 'Provider', type: 'xtream', url: 'http://provider.example:8080', username: 'u', password: 'p', enabled: true },
    { id: 'b2', name: 'Local', type: 'm3u', url: 'imported:Local', enabled: true, playlist: '#EXTM3U\n' },
  ],
  settings: { channelSortOrder: 'number', guideOpacity: 0.9, liveSourceOrder: ['a1', 'b2'] },
  apiKeys: { tmdb: 'k' },
  lists: { favorites: [{ id: 'channel_a1_1', type: 'channel', stream_id: 'a1_1', added: '2026-10-01T00:00:00.000Z' }] },
});

test('a well-formed body passes and keeps only what it declared', () => {
  const body = validateSetupBody(good());
  assert.equal(body.sources?.length, 2);
  assert.equal(body.apiKeys?.tmdb, 'k');
});

test('unknown fields, unknown settings and secrets in settings are rejected', () => {
  assert.throws(() => validateSetupBody({ ...good(), extra: 1 }), /invalid/);
  assert.throws(() => validateSetupBody({ ...good(), settings: { linuxPlayerMode: 'compatibility' } }), /invalid/);
  assert.throws(() => validateSetupBody({ ...good(), settings: { tmdbApiKey: 'x' } }), /invalid/);
  assert.throws(() => validateSetupBody({ ...good(), sources: [{ ...good().sources[0], admin: true }] }), /invalid/);
});

test('source addresses must be http(s); a playlist only rides with an imported: source', () => {
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://x', '']) {
    assert.throws(() => validateSetupBody({ ...good(), sources: [{ ...good().sources[0], url }] }), /invalid/, url);
  }
  assert.throws(() => validateSetupBody({ ...good(), sources: [{ ...good().sources[0], playlist: '#EXTM3U' }] }), /invalid/);
  assert.throws(() => validateSetupBody({ ...good(), sources: [{ ...good().sources[0], epg_url: 'file:///x' }] }), /invalid/);
});

test('sizes are capped: sources, playlists, lists, strings', () => {
  const many = Array.from({ length: 201 }, (_, i) => ({ ...good().sources[0], id: `s${i}` }));
  assert.throws(() => validateSetupBody({ ...good(), sources: many }), /invalid/);
  const big = { ...good().sources[1], playlist: 'x'.repeat(64 * 1024 * 1024 + 1) };
  assert.throws(() => validateSetupBody({ ...good(), sources: [big] }), /invalid/);
  assert.throws(() => validateSetupBody({ ...good(), lists: { favorites: Array(200_001).fill({}) } }), /invalid/);
  assert.throws(() => validateSetupBody({ ...good(), sources: [{ ...good().sources[0], name: 'n'.repeat(2001) }] }), /invalid/);
  assert.throws(() => validateSetupBody({ ...good(), sources: [good().sources[0], good().sources[0]] }), /invalid/); // duplicate id
});

test('only the travelling settings are exported', () => {
  const out = settingsForExport({ channelSortOrder: 'number', linuxPlayerMode: 'compatibility', debugLoggingEnabled: true, tmdbApiKey: 'k', betaUpdates: true } as never);
  assert.deepEqual(out, { channelSortOrder: 'number' });
  assert.ok(!SETUP_SETTING_KEYS.includes('tmdbApiKey' as never));
});

test('an import keeps machine settings and internal markers, nothing it replaces', () => {
  const stored = { theme: 'dark', channelSortOrder: 'number', linuxPlayerMode: 'compatibility', debugLoggingEnabled: true, betaUpdates: true, sportsDefaultSettled: true, rewindLiveBytes: 5, encryptedTmdbApiKey: 'x' };
  assert.deepEqual(keptOnImport(stored), { linuxPlayerMode: 'compatibility', debugLoggingEnabled: true, betaUpdates: true, sportsDefaultSettled: true, rewindLiveBytes: 5 });
});

test('the preview says what is inside without secrets', () => {
  const p = describeSetup(validateSetupBody(good()));
  assert.deepEqual(p.sources, [
    { name: 'Provider', type: 'xtream', withLogin: true, fromFile: false, host: 'provider.example' },
    { name: 'Local', type: 'm3u', withLogin: false, fromFile: true, host: null },
  ]);
  assert.equal(p.favorites, 1);
  assert.equal(JSON.stringify(p).includes('"p"'), false);
  // Where each source connects, so the person importing can check it; never a path, query or login.
  const m3u = describeSetup(validateSetupBody({ ...good(), sources: [{ id: 'm1', name: 'M', type: 'm3u', url: 'http://user:pw@lists.example:80/get.php?username=u&password=p', enabled: true }] }));
  assert.equal(m3u.sources[0].host, 'lists.example');
});

test('a setup file cannot turn on LAN sources (that guard is this computer\'s choice)', () => {
  assert.throws(() => validateSetupBody({ ...good(), settings: { allowLanSources: true } }), /invalid/);
  assert.deepEqual(settingsForExport({ allowLanSources: true, guideOpacity: 0.9 } as never), { guideOpacity: 0.9 });
  assert.deepEqual(keptOnImport({ allowLanSources: true, guideOpacity: 0.9 }), { allowLanSources: true });
});

test('settings values are typed and bounded, so a bad file cannot break the app on start', () => {
  const bad: Record<string, unknown>[] = [
    { liveSourceOrder: 'x' }, { vodSourceOrder: [1, 2] }, { movieGenresEnabled: 'all' }, { seriesGenresEnabled: ['a'] },
    { channelSortOrder: 'random' }, { categorySortOrder: 'x' }, { theme: 'neon' },
    { categoryBarWidth: 'wide' }, { channelColumnWidth: -5 }, { guideOpacity: 3 }, { guideOpacity: Number.NaN },
    { epgRefreshHours: -1 }, { vodRefreshHours: 1e9 }, { guideMorphEnabled: 'yes' }, { lastSourceId: 5 },
    { appearance: 'dark' }, { subtitles: [1] },
  ];
  for (const settings of bad) assert.throws(() => validateSetupBody({ ...good(), settings }), /invalid/, JSON.stringify(settings));
  const ok = { liveSourceOrder: ['a1'], movieGenresEnabled: [28, 12], channelSortOrder: 'number', categorySortOrder: 'provider', theme: 'light',
    categoryBarWidth: 180, guideOpacity: 0.8, epgRefreshHours: 0, vodRefreshHours: 48, guideMorphEnabled: false, appearance: { palette: 'sbtl' }, subtitles: { size: 1 } };
  assert.deepEqual(validateSetupBody({ ...good(), settings: ok }).settings, ok);
});

test('an export the validator refuses says which source and what, not "invalid file"', () => {
  const sources = [{ name: 'Provider' }, { name: 'Local' }];
  assert.equal(explainExportProblem('invalid: sources[0].url', sources), 'Provider can\'t be exported: its address has to start with http:// or https://.');
  assert.equal(explainExportProblem('invalid: sources[1].epg_url', sources), 'Local can\'t be exported: its guide address has to start with http:// or https://.');
  assert.equal(explainExportProblem('invalid: sources[1].playlist', sources), 'Local can\'t be exported: its playlist is too large.');
  assert.equal(explainExportProblem('invalid: sources[0].name', sources), 'Provider can\'t be exported: one of its details is too long.');
  assert.equal(explainExportProblem('invalid: settings.guideOpacity', sources), 'A setting has a value sbtlTV can\'t export (guideOpacity).');
  assert.equal(explainExportProblem('invalid: lists.favorites', sources), 'Your favorites can\'t be exported: there are too many.');
  assert.equal(explainExportProblem('something else', sources), 'Your setup can\'t be exported. Details are in the debug log.');
});

// ---- review 8 (tests lens): kill tests ----
test('R8: stricter shapes: imported: only on m3u, id charset, typed flags, capped secrets, known parts and fields', () => {
  const src = good().sources[0];
  for (const s of [{ ...src, url: 'imported:x' }, { ...src, id: '../x' }, { ...src, id: 'a b' }, { ...src, auto_load_epg: 'yes' }, { ...src, password: 'p'.repeat(2001) }]) {
    assert.throws(() => validateSetupBody({ ...good(), sources: [s] }), /invalid/, JSON.stringify(s).slice(0, 80));
  }
  assert.throws(() => validateSetupBody({ ...good(), includes: ['everything'] }), /invalid/);
  assert.throws(() => validateSetupBody({ ...good(), apiKeys: { tmdb: 'k', other: 'x' } }), /invalid/);
  assert.throws(() => validateSetupBody({ ...good(), lists: { history: [] } }), /invalid/);
});

test('R8: the rest of the settings are typed and capped too', () => {
  const bad: Record<string, unknown>[] = [
    { rpdbBackdropsEnabled: 'yes' }, { sportsMatchupEnabled: 1 }, { autoplayNextEpisode: 'no' },
    { liveSourceOrder: Array(1001).fill('a') }, { lastSourceId: 'x'.repeat(201) }, { appearance: { palette: 'x'.repeat(10_000) } },
  ];
  for (const settings of bad) assert.throws(() => validateSetupBody({ ...good(), settings }), /invalid/, JSON.stringify(settings).slice(0, 60));
});

test('R8: the preview counts every part it shows', () => {
  const p = describeSetup(validateSetupBody({ ...good(), settings: undefined, apiKeys: { posterDb: 'k' }, lists: { watchlist: [{ id: 'w' }], progress: [{ id: 'a' }, { id: 'b' }] } }));
  assert.deepEqual([p.settings, p.apiKeys, p.favorites, p.watchlist, p.progress], [false, true, 0, 1, 2]);
});

const storedSetup = () => ({
  sources: [
    { id: 'x1', name: 'Provider', type: 'xtream' as const, url: 'http://p.example', username: 'u', password: 'secret', enabled: true },
    { id: 'f1', name: 'Local', type: 'm3u' as const, url: 'imported:Local', enabled: true },
  ],
  settings: { channelSortOrder: 'number', tmdbApiKey: 'tk', posterDbApiKey: 'pk', debugLoggingEnabled: true } as never,
});
const meta = { app: '0.13.1', exportedAt: '2026-10-19T12:00:00.000Z', platform: 'linux' };

test('with logins off, no password goes in the file', () => {
  const body = buildSetupBody(['sources', 'settings'], storedSetup(), {}, {}, meta);
  assert.equal(JSON.stringify(body).includes('secret'), false);
  assert.equal(body.sources?.[0].username, 'u');
  assert.equal(buildSetupBody(['sources', 'logins'], storedSetup(), {}, {}, meta).sources?.[0].password, 'secret');
});

test('only ticked parts go in: no keys, lists or settings unless asked', () => {
  const lists = { favorites: [{ id: 'channel_x1_1' }], watchlist: [{ id: 'movie_1' }], progress: [{ id: 'movie_x1_1' }], lastCategory: 'x1_news' };
  const none = buildSetupBody(['sources'], storedSetup(), lists, {}, meta);
  assert.equal(none.apiKeys, undefined); assert.equal(none.settings, undefined); assert.equal(none.lists, undefined);
  const all = buildSetupBody(['settings', 'apiKeys', 'favorites', 'watchlist'], storedSetup(), lists, {}, meta);
  assert.deepEqual(all.apiKeys, { tmdb: 'tk', posterDb: 'pk' });
  assert.deepEqual(all.settings, { channelSortOrder: 'number' });
  assert.deepEqual(Object.keys(all.lists ?? {}).sort(), ['favorites', 'lastCategory', 'watchlist']);
  assert.equal(all.sources, undefined);
});

test('a file playlist still waiting to be imported travels as its pending content, not an empty rebuild', () => {
  const body = buildSetupBody(['sources'], storedSetup(), {}, { f1: '#EXTM3U\n' }, meta, { f1: '#EXTM3U\n#EXTINF:-1,One\nhttp://s/1\n' });
  assert.equal(body.sources?.[1].playlist, '#EXTM3U\n#EXTINF:-1,One\nhttp://s/1\n');
  assert.equal(buildSetupBody(['sources'], storedSetup(), {}, { f1: '#EXTM3U\n' }, meta).sources?.[1].playlist, '#EXTM3U\n');
});

test('the SubDL key travels under apiKeys only, typed and capped like the others', () => {
  const body = validateSetupBody({ ...good(), apiKeys: { subdl: 'subdl_key' } });
  assert.equal(body.apiKeys?.subdl, 'subdl_key');
  assert.equal(describeSetup(validateSetupBody({ ...good(), settings: undefined, apiKeys: { subdl: 'k' } })).apiKeys, true);
  assert.throws(() => validateSetupBody({ ...good(), apiKeys: { subdl: 5 } }), /invalid/);
  const stored = { ...storedSetup(), settings: { channelSortOrder: 'number', subdlApiKey: 'sk' } as never };
  const out = buildSetupBody(['settings', 'apiKeys'], stored, {}, {}, meta);
  assert.deepEqual(out.apiKeys, { subdl: 'sk' });
  assert.equal(JSON.stringify(out.settings).includes('sk'), false);
});
