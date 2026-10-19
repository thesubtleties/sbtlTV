import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SETUP_SETTING_KEYS, describeSetup, explainExportProblem, keptOnImport, settingsForExport, validateSetupBody } from './setup-body.js';

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
    { name: 'Provider', type: 'xtream', withLogin: true, fromFile: false },
    { name: 'Local', type: 'm3u', withLogin: false, fromFile: true },
  ]);
  assert.equal(p.favorites, 1);
  assert.equal(JSON.stringify(p).includes('"p"'), false);
  assert.equal(JSON.stringify(p).includes('provider.example'), false);
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
  assert.equal(explainExportProblem('invalid: settings.guideOpacity', sources), 'A setting can\'t be exported (guideOpacity has a value sbtlTV doesn\'t expect).');
  assert.equal(explainExportProblem('invalid: lists.favorites', sources), 'Your favorites can\'t be exported: there are too many.');
  assert.equal(explainExportProblem('something else', sources), 'Your setup can\'t be exported (something else).');
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
