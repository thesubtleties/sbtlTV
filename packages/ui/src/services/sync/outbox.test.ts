import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncRecord } from '@sbtltv/core';
import { db } from '../../db';
import { updateWatchProgress, clearProgressIds, clearProgressSeries } from '../../hooks/useWatchProgress';
import { toggleWatchlist } from '../../hooks/useWatchlist';
import { setSyncActive } from './outbox';

const sent: SyncRecord[] = [];
beforeEach(async () => {
  sent.length = 0;
  await db.watchlist.clear(); await db.watchProgress.clear();
  (globalThis as unknown as { window: unknown }).window = { sync: { record: vi.fn(async (r: SyncRecord[]) => { sent.push(...r); }) } };
  setSyncActive(true);
});
afterEach(() => setSyncActive(false));

describe('changes go to sync as TMDB-keyed records', () => {
  it('watchlist add, then remove (a removal record)', async () => {
    await toggleWatchlist('movie', { tmdbId: 603, name: 'The Matrix' });
    await toggleWatchlist('movie', { tmdbId: 603, name: 'The Matrix' });
    expect(sent.map((r) => [r.k, 'removed' in r && r.removed === true])).toEqual([['wl', false], ['wl', true]]);
  });

  it('a watchlist item without a TMDB id does not sync', async () => {
    await toggleWatchlist('movie', { streamId: 's1', name: 'Local' });
    expect(sent).toEqual([]);
  });

  it('saving progress sends the movie record; clearing it sends a removal', async () => {
    await updateWatchProgress({ type: 'movie', streamId: 's1_1', tmdbId: 603, position: 600, duration: 8160, name: 'The Matrix' });
    expect(sent[sent.length - 1]).toMatchObject({ k: 'pm', tmdb: 603, pos: 600 });
    await clearProgressIds(['movie_s1_1']);
    expect(sent[sent.length - 1]).toMatchObject({ k: 'pm', tmdb: 603, removed: true });
  });

  it('clearing a series sends a removal per episode', async () => {
    for (const e of [1, 2]) await updateWatchProgress({ type: 'episode', streamId: `ep${e}`, tmdbId: 1399, seriesTmdbId: 1399, seasonNum: 1, episodeNum: e, position: 10, duration: 100, name: 'GoT' });
    sent.length = 0;
    await clearProgressSeries({ tmdbId: 1399 });
    expect(sent.map((r) => r.k === 'pe' && r.removed && r.e).sort()).toEqual([1, 2]);
  });

  it("the 15-second saves during playback stay on this computer; pause, stop and quit send (I1)", async () => {
    await updateWatchProgress({ type: 'movie', streamId: 's1_1', tmdbId: 603, position: 15, duration: 8160, name: 'M' }, { sync: false });
    expect(sent).toEqual([]);
    await updateWatchProgress({ type: 'movie', streamId: 's1_1', tmdbId: 603, position: 30, duration: 8160, name: 'M' });
    expect(sent).toHaveLength(1);
  });

  it('nothing is sent while sync is off', async () => {
    setSyncActive(false);
    await toggleWatchlist('series', { tmdbId: 1399, name: 'GoT' });
    expect(sent).toEqual([]);
  });
});
