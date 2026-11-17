import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db';
import { applyFavoriteRecords, rematchFavorites, type MatchContext } from './applyFavorites';

const ch = (stream_id: string, source_id: string, name: string, epg = '', num: number | null = null) => ({ stream_id, source_id, name, channel_num: num, epg_channel_id: epg });
const fav = (over: Partial<{ host: string; ch: string; guide: string; name: string; at: number; removed: true }> = {}) =>
  ({ k: 'fav' as const, host: 'provider.example', ch: '1234', guide: 'CNN.us', name: 'CNN HD', at: 5_000, ...over });
const src = { id: 'm1', url: 'http://provider.example:8080' };
const ctx = (over: Partial<MatchContext> = {}): MatchContext => ({ sources: [src], allSources: [src], byId: new Map(), byGuide: [], ...over });
const load = (c: MatchContext) => async () => c;

beforeEach(async () => { await db.favorites.clear(); });

describe('applyFavoriteRecords', () => {
  it("not on this computer: kept as a favorite without a channel", async () => {
    await applyFavoriteRecords([fav()], load(ctx()));
    const rows = await db.favorites.toArray();
    expect(rows).toEqual([expect.objectContaining({ id: 'channel_sync_provider.example_1234', type: 'channel', name: 'CNN HD', sync: { host: 'provider.example', ch: '1234', guide: 'CNN.us' } })]);
    expect(rows[0].stream_id).toBeUndefined();
  });
  it("on this computer: this computer's channel becomes the favorite", async () => {
    await applyFavoriteRecords([fav()], load(ctx({ byId: new Map([['m1_1234', ch('m1_1234', 'm1', 'US: CNN')]]) })));
    expect(await db.favorites.toArray()).toEqual([expect.objectContaining({ id: 'channel_m1_1234', stream_id: 'm1_1234', sync: { host: 'provider.example', ch: '1234', guide: 'CNN.us' } })]);
  });
  it('already a favorite here (both computers had it before joining): still one favorite (Review Focus 1)', async () => {
    await db.favorites.put({ id: 'channel_m1_1234', type: 'channel', stream_id: 'm1_1234', name: 'US: CNN', added: new Date(1_000) });
    await applyFavoriteRecords([fav()], load(ctx({ byId: new Map([['m1_1234', ch('m1_1234', 'm1', 'US: CNN')]]) })));
    const rows = await db.favorites.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'channel_m1_1234', name: 'US: CNN' });
  });
  it("a removal drops the favorite it names, matched or not, local or synced, if it was added before", async () => {
    await db.favorites.bulkPut([
      { id: 'channel_m1_1234', type: 'channel', stream_id: 'm1_1234', name: 'CNN', added: new Date(1_000) },
      { id: 'channel_sync_provider.example_77', type: 'channel', name: 'ESPN', added: new Date(1_000), sync: { host: 'provider.example', ch: '77' } },
      { id: 'channel_m1_88', type: 'channel', stream_id: 'm1_88', name: 'HBO', added: new Date(9_000) },
    ]);
    await applyFavoriteRecords([fav({ removed: true }), fav({ ch: '77', removed: true }), fav({ ch: '88', removed: true })], load(ctx()));
    expect((await db.favorites.toArray()).map((f) => f.id)).toEqual(['channel_m1_88']);
  });
  it('a guide-id match lands on the closest channel', async () => {
    await applyFavoriteRecords([fav({ host: 'elsewhere.example' })], load(ctx({ byGuide: [ch('m1_8', 'm1', 'CNN SD', 'CNN.us', 3), ch('m1_9', 'm1', 'CNN HD', 'CNN.us', 7)] })));
    expect((await db.favorites.toArray()).map((f) => f.stream_id)).toEqual(['m1_9']);
  });
});

describe('rematchFavorites', () => {
  it("a favorite waiting for its channel gets it once the channel exists (Review Focus 2)", async () => {
    await applyFavoriteRecords([fav()], load(ctx()));
    await rematchFavorites(load(ctx({ byId: new Map([['m1_1234', ch('m1_1234', 'm1', 'CNN')]]) })));
    expect(await db.favorites.toArray()).toEqual([expect.objectContaining({ id: 'channel_m1_1234', stream_id: 'm1_1234', sync: { host: 'provider.example', ch: '1234', guide: 'CNN.us' } })]);
  });
});
