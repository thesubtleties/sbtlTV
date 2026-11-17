import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db';
import { useUIStore } from '../../stores/uiStore';
import { applyFavoriteRecords, rematchFavorites, type MatchContext } from './applyFavorites';

const ch = (stream_id: string, source_id: string, name: string, epg = '', num: number | null = null) => ({ stream_id, source_id, name, channel_num: num, guides: epg ? [epg] : [] });
const fav = (over: Partial<{ host: string; ch: string; guide: string; name: string; at: number; removed: true }> = {}) =>
  ({ k: 'fav' as const, host: 'provider.example', ch: '1234', guide: 'CNN.us', name: 'CNN HD', at: 5_000, ...over });
const src = { id: 'm1', url: 'http://provider.example:8080' };
const ctx = (over: Partial<MatchContext> = {}): MatchContext => ({ sources: [src], allSources: [src], byId: new Map(), byGuide: [], ...over });
const load = (c: MatchContext) => async () => c;
const keys = (ids?: { host: string; ch: string }[]) => (ids ?? []).map((i) => `${i.host}:${i.ch}`).sort();

beforeEach(async () => { await db.favorites.clear(); useUIStore.getState().hydrateSources([]); });

describe('applyFavoriteRecords', () => {
  it('not on this computer: kept as a favorite without a channel', async () => {
    await applyFavoriteRecords([fav()], load(ctx()));
    const rows = await db.favorites.toArray();
    expect(rows).toEqual([expect.objectContaining({ id: 'channel_sync_provider.example_1234', type: 'channel', name: 'CNN HD', ids: [{ host: 'provider.example', ch: '1234', guide: 'CNN.us' }] })]);
    expect(rows[0].stream_id).toBeUndefined();
  });

  it("on this computer: this computer's channel becomes the favorite", async () => {
    await applyFavoriteRecords([fav()], load(ctx({ byId: new Map([['m1_1234', ch('m1_1234', 'm1', 'US: CNN')]]) })));
    const rows = await db.favorites.toArray();
    expect(rows).toEqual([expect.objectContaining({ id: 'channel_m1_1234', stream_id: 'm1_1234' })]);
    expect(keys(rows[0].ids)).toEqual(['provider.example:1234']);
  });

  it('already a favorite here (both computers had it before joining): still one favorite, now known by both ids (Review Focus 1)', async () => {
    await db.favorites.put({ id: 'channel_m1_9', type: 'channel', stream_id: 'm1_9', name: 'US: CNN', added: new Date(1_000) });
    await applyFavoriteRecords([fav({ host: 'elsewhere.example' })], load(ctx({ byGuide: [ch('m1_9', 'm1', 'US: CNN', 'CNN.us')] })));
    const rows = await db.favorites.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'channel_m1_9', name: 'US: CNN' });
    expect(keys(rows[0].ids)).toEqual(['elsewhere.example:1234', 'provider.example:9']);
  });

  it('two computers that had the same channel under different ids: unfavoriting on either reaches the other (lens 1/6/8 I1)', async () => {
    // B had CNN (provider.example:9); A's CNN HD (elsewhere.example:1234) lands on it
    await db.favorites.put({ id: 'channel_m1_9', type: 'channel', stream_id: 'm1_9', name: 'US: CNN', added: new Date(1_000) });
    await applyFavoriteRecords([fav({ host: 'elsewhere.example' })], load(ctx({ byGuide: [ch('m1_9', 'm1', 'US: CNN', 'CNN.us')] })));
    // A unfavorites: removals for both ids it knows (its own and B's, which reached it the same way)
    await applyFavoriteRecords([fav({ host: 'elsewhere.example', at: 9_000, removed: true }), fav({ host: 'provider.example', ch: '9', at: 9_000, removed: true })], load(ctx()));
    expect(await db.favorites.toArray()).toEqual([]);
  });

  it('two favorites from another computer on one channel here: removing one keeps the channel a favorite (lens 1 M1)', async () => {
    const one = ctx({ byGuide: [ch('m1_9', 'm1', 'CNN', 'CNN.us')] });
    await applyFavoriteRecords([fav({ host: 'a.example', ch: '1', name: 'CNN HD' }), fav({ host: 'a.example', ch: '2', name: 'CNN SD' })], load(one));
    await applyFavoriteRecords([fav({ host: 'a.example', ch: '1', at: 9_000, removed: true })], load(ctx()));
    const rows = await db.favorites.toArray();
    expect(rows.map((r) => r.id)).toEqual(['channel_m1_9']);
    expect(keys(rows[0].ids)).toEqual(['a.example:2', 'provider.example:9']);
  });

  it('a removal drops the favorite it names, matched or not, local or synced, if it was added before', async () => {
    await db.favorites.bulkPut([
      { id: 'channel_m1_1234', type: 'channel', stream_id: 'm1_1234', name: 'CNN', added: new Date(1_000) },
      { id: 'channel_sync_provider.example_77', type: 'channel', name: 'ESPN', added: new Date(1_000), ids: [{ host: 'provider.example', ch: '77' }] },
      { id: 'channel_m1_88', type: 'channel', stream_id: 'm1_88', name: 'HBO', added: new Date(9_000) },
    ]);
    await applyFavoriteRecords([fav({ removed: true }), fav({ ch: '77', removed: true }), fav({ ch: '88', removed: true })], load(ctx()));
    expect((await db.favorites.toArray()).map((f) => f.id)).toEqual(['channel_m1_88']);
  });

  it('a guide-id match lands on the closest channel', async () => {
    await applyFavoriteRecords([fav({ host: 'elsewhere.example' })], load(ctx({ byGuide: [ch('m1_8', 'm1', 'CNN SD', 'CNN.us', 3), ch('m1_9', 'm1', 'CNN HD', 'CNN.us', 7)] })));
    expect((await db.favorites.toArray()).map((f) => f.stream_id)).toEqual(['m1_9']);
  });

  it('a removal reaches a favorite that landed on a different channel here: it answers to the id it came with (Review Focus 4)', async () => {
    await db.favorites.put({ id: 'channel_m1_9', type: 'channel', stream_id: 'm1_9', name: 'CNN HD', added: new Date(1_000), ids: [{ host: 'elsewhere.example', ch: '1234', guide: 'CNN.us' }] });
    await applyFavoriteRecords([fav({ host: 'elsewhere.example', removed: true })], load(ctx()));
    expect(await db.favorites.toArray()).toEqual([]);
  });

  it("a local favorite on a source that's turned off still answers to its removal", async () => {
    await db.favorites.put({ id: 'channel_m1_1234', type: 'channel', stream_id: 'm1_1234', name: 'CNN', added: new Date(1_000) });
    await applyFavoriteRecords([fav({ removed: true })], load(ctx({ sources: [] })));
    expect(await db.favorites.toArray()).toEqual([]);
  });

  it("already a favorite here on a source that's turned off: no second, grayed row for it", async () => {
    await db.favorites.put({ id: 'channel_m1_1234', type: 'channel', stream_id: 'm1_1234', name: 'CNN', added: new Date(1_000) });
    await applyFavoriteRecords([fav()], load(ctx({ sources: [] })));
    expect((await db.favorites.toArray()).map((f) => f.id)).toEqual(['channel_m1_1234']);
  });
});

describe('rematchFavorites', () => {
  it('a favorite waiting for its channel gets it once the channel exists (Review Focus 2)', async () => {
    await applyFavoriteRecords([fav()], load(ctx()));
    await rematchFavorites(load(ctx({ byId: new Map([['m1_1234', ch('m1_1234', 'm1', 'CNN')]]) })));
    const rows = await db.favorites.toArray();
    expect(rows).toEqual([expect.objectContaining({ id: 'channel_m1_1234', stream_id: 'm1_1234' })]);
    expect(keys(rows[0].ids)).toEqual(['provider.example:1234']);
  });

  it('a favorite that found its channel keeps the time it was made: a removal made after that still drops it', async () => {
    await applyFavoriteRecords([fav({ at: 5_000 })], load(ctx()));
    await rematchFavorites(load(ctx({ byId: new Map([['m1_1234', ch('m1_1234', 'm1', 'CNN')]]) })));
    expect(+(await db.favorites.get('channel_m1_1234'))!.added).toBe(5_000);
    await applyFavoriteRecords([fav({ at: 6_000, removed: true })], load(ctx()));
    expect(await db.favorites.toArray()).toEqual([]);
  });

  it("a favorite from another computer whose source here was deleted moves to a channel on a source that's on (lens 1 M5)", async () => {
    useUIStore.getState().hydrateSources([{ id: 'm2', name: 'B', type: 'm3u', url: 'http://other.example', enabled: true }]);
    await db.favorites.put({ id: 'channel_gone_5', type: 'channel', stream_id: 'gone_5', name: 'CNN HD', added: new Date(1_000), ids: [{ host: 'provider.example', ch: '5', guide: 'CNN.us' }] });
    const m2 = { id: 'm2', url: 'http://other.example' };
    await rematchFavorites(load({ sources: [m2], allSources: [m2], byId: new Map(), byGuide: [ch('m2_3', 'm2', 'CNN HD', 'CNN.us')] }));
    expect((await db.favorites.toArray()).map((f) => f.id)).toEqual(['channel_m2_3']);
  });

  it('a Remove while the channel lookup runs wins: the favorite does not come back (lens 1 M2)', async () => {
    await applyFavoriteRecords([fav()], load(ctx()));
    await rematchFavorites(async () => {
      await db.favorites.delete('channel_sync_provider.example_1234');   // removed meanwhile
      return ctx({ byId: new Map([['m1_1234', ch('m1_1234', 'm1', 'CNN')]]) });
    });
    expect(await db.favorites.toArray()).toEqual([]);
  });
});
