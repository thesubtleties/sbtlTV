import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import { data } from '../../data/client';
import { useUIStore } from '../../stores/uiStore';
import { loadMatchContext } from './applyFavorites';
import { applyRecords } from './apply';

vi.mock('../../data/client', () => ({ data: { query: vi.fn(async () => []) } }));
const query = vi.mocked(data.query);

const source = (id: string, url: string, enabled = true) => ({ id, name: id, type: 'xtream' as const, url, enabled });
const wanted = { host: 'provider.example', ch: '1234', guide: 'CNN.us' };

beforeEach(async () => {
  query.mockClear();
  useUIStore.getState().hydrateSources([]);
  await db.favorites.clear();
});

describe('loadMatchContext', () => {
  it('asks only for the same channel on enabled sources of that server, and guide ids on enabled sources only', async () => {
    useUIStore.getState().hydrateSources([source('m1', 'http://provider.example:8080'), source('m2', 'http://other.example'), source('m3', 'http://provider.example', false)]);
    const ctx = await loadMatchContext([wanted]);
    expect(query).toHaveBeenCalledWith({ type: 'channelsByIds', streamIds: ['m1_1234'] });
    expect(query).toHaveBeenCalledWith({ type: 'channelsByGuideIds', guideIds: ['CNN.us'], sourceIds: ['m1', 'm2'] });
    expect(ctx.sources.map((s) => s.id)).toEqual(['m1', 'm2']);
    expect(ctx.allSources.map((s) => s.id)).toEqual(['m1', 'm2', 'm3']);
  });
  it('no enabled source: no query at all (an empty source list would mean every source to the data process)', async () => {
    useUIStore.getState().hydrateSources([source('m1', 'http://provider.example', false)]);
    const ctx = await loadMatchContext([wanted]);
    expect(query).not.toHaveBeenCalled();
    expect(ctx.sources).toEqual([]);
  });
});

describe('applyRecords routes favorites', () => {
  it('a favorite record from another computer is written into the favorites', async () => {
    await applyRecords([{ k: 'fav', host: 'provider.example', ch: '1234', name: 'CNN', at: 5_000 }], async () => []);
    expect((await db.favorites.toArray()).map((f) => f.id)).toEqual(['channel_sync_provider.example_1234']);
  });
});

describe('applyRecords keeps favorites from holding back the rest', () => {
  it("a favorites failure: the watchlist still lands, and the favorites aren't confirmed (they come again)", async () => {
    useUIStore.getState().hydrateSources([source('m1', 'http://provider.example')]);
    (globalThis as unknown as { window: unknown }).window = {};   // debugLog's renderer bridge
    query.mockRejectedValueOnce(new Error('data process gone'));
    const wl = { k: 'wl' as const, type: 'movie' as const, tmdb: 603, name: 'The Matrix', at: 5_000 };
    const done = await applyRecords([{ k: 'fav', host: 'provider.example', ch: '1234', name: 'CNN', at: 5_000 }, wl], async () => []);
    expect(await db.watchlist.get('movie_603')).toBeDefined();
    expect(done).toEqual([wl]);
  });
});
