import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncRecord } from '@sbtltv/core';
import { db } from '../../db';
import { useUIStore } from '../../stores/uiStore';
import { removeFavoriteRow, toggleFavoriteChannel } from '../../hooks/useFavorites';
import { data } from '../../data/client';
import { sendSnapshot, setSyncActive } from './outbox';

vi.mock('../../data/client', () => ({
  data: {
    query: vi.fn(async (req: { type: string; streamIds?: string[] }) => (req.type === 'favoriteGuides'
      ? [{ stream_id: 'm1_77', guide: 'ESPN.us' }].filter((c) => req.streamIds?.includes(c.stream_id))
      : [])),
  },
}));

const sent: SyncRecord[] = [];
beforeEach(async () => {
  sent.length = 0;
  await db.favorites.clear(); await db.watchlist.clear(); await db.watchProgress.clear();
  (globalThis as unknown as { window: unknown }).window = { sync: { record: vi.fn(async (r: SyncRecord[]) => { sent.push(...r); }) } };
  useUIStore.getState().hydrateSources([{ id: 'm1', name: 'P', type: 'xtream', url: 'http://user:pw@Provider.Example:8080', enabled: true }]);
  setSyncActive(true);
});
afterEach(() => setSyncActive(false));

describe('favorites go out to the other computers', () => {
  it('a favorite: its server, channel id and guide id; unfavorite: a removal', async () => {
    await toggleFavoriteChannel('m1_77', 'ESPN');
    await toggleFavoriteChannel('m1_77', 'ESPN');
    expect(sent.map((r) => ({ ...r, at: 0 }))).toEqual([
      { k: 'fav', host: 'provider.example', ch: '77', guide: 'ESPN.us', name: 'ESPN', at: 0 },
      { k: 'fav', host: 'provider.example', ch: '77', guide: 'ESPN.us', name: 'ESPN', at: 0, removed: true },
    ]);
  });
  it('unfavoriting one that came from another computer sends the removal under its original key (Review Focus 4)', async () => {
    await db.favorites.put({ id: 'channel_m1_77', type: 'channel', stream_id: 'm1_77', name: 'ESPN', added: new Date(1), ids: [{ host: 'other.example', ch: '5' }] });
    await toggleFavoriteChannel('m1_77', 'ESPN');
    expect(sent).toEqual([expect.objectContaining({ k: 'fav', host: 'other.example', ch: '5', removed: true })]);
  });
  it('unfavoriting one known by several ids (its own and another computer\'s) removes it under every one, so every computer drops it (lens 1/6/8 I1)', async () => {
    await db.favorites.put({ id: 'channel_m1_77', type: 'channel', stream_id: 'm1_77', name: 'ESPN', added: new Date(1), ids: [{ host: 'provider.example', ch: '77' }, { host: 'other.example', ch: '5' }] });
    await toggleFavoriteChannel('m1_77', 'ESPN');
    expect(sent.map((r) => [(r as { host: string }).host, (r as { removed?: true }).removed])).toEqual([['provider.example', true], ['other.example', true]]);
  });
  it('the snapshot includes channel favorites, also ones waiting for their channel', async () => {
    await db.favorites.bulkPut([
      { id: 'channel_m1_77', type: 'channel', stream_id: 'm1_77', name: 'ESPN', added: new Date(1) },
      { id: 'channel_sync_x.example_9', type: 'channel', name: 'Waiting', added: new Date(1), ids: [{ host: 'x.example', ch: '9' }] },
    ]);
    await sendSnapshot();
    expect(sent.filter((r) => r.k === 'fav').map((r) => (r as { host: string; ch: string }).host + ':' + (r as { ch: string }).ch).sort()).toEqual(['provider.example:77', 'x.example:9']);
  });
  it('the snapshot dates each favorite when it was made, so a later removal from another computer still wins', async () => {
    await db.favorites.put({ id: 'channel_m1_77', type: 'channel', stream_id: 'm1_77', name: 'ESPN', added: new Date(1_234) });
    await sendSnapshot();
    expect(sent.filter((r) => r.k === 'fav').map((r) => r.at)).toEqual([1_234]);
  });
  it('Remove on a grayed favorite (not on this computer) sends the removal under its key', async () => {
    const row = { id: 'channel_sync_x.example_9', type: 'channel' as const, name: 'Waiting', added: new Date(1), ids: [{ host: 'x.example', ch: '9' }] };
    await db.favorites.put(row);
    await removeFavoriteRow(row);
    expect(await db.favorites.get(row.id)).toBeUndefined();
    expect(sent).toEqual([expect.objectContaining({ k: 'fav', host: 'x.example', ch: '9', removed: true })]);
  });
  it('the guide lookup failing: the favorite is saved and sent without a guide id, nothing throws', async () => {
    vi.mocked(data.query).mockRejectedValueOnce(new Error('data process gone'));
    await expect(toggleFavoriteChannel('m1_77', 'ESPN')).resolves.toBeUndefined();
    expect(await db.favorites.get('channel_m1_77')).toBeDefined();
    expect(sent).toEqual([{ k: 'fav', host: 'provider.example', ch: '77', name: 'ESPN', at: expect.any(Number) }]);
  });
  it('its own id is saved when it is made, so editing the provider\'s address later doesn\'t change which favorite it is (lens 8 I2)', async () => {
    await toggleFavoriteChannel('m1_77', 'ESPN');
    useUIStore.getState().hydrateSources([{ id: 'm1', name: 'P', type: 'xtream', url: 'http://new-dns.example', enabled: true }]);
    sent.length = 0;
    await toggleFavoriteChannel('m1_77', 'ESPN');
    expect(sent).toEqual([expect.objectContaining({ host: 'provider.example', ch: '77', removed: true })]);
  });
  it('with Sync off nothing is sent (its own id is still saved)', async () => {
    setSyncActive(false);
    await toggleFavoriteChannel('m1_77', 'ESPN');
    expect(sent).toEqual([]);
    expect((await db.favorites.get('channel_m1_77'))?.ids).toEqual([{ host: 'provider.example', ch: '77', guide: 'ESPN.us' }]);
  });
  it('a failed favorites lookup leaves favorites out of the snapshot, not the watchlist and progress (lens 3/9)', async () => {
    await db.favorites.put({ id: 'channel_m1_77', type: 'channel', stream_id: 'm1_77', name: 'ESPN', added: new Date(1) });
    await db.watchlist.put({ id: 'movie_603', type: 'movie', tmdb_id: 603, name: 'The Matrix', added: new Date(1) });
    vi.mocked(data.query).mockRejectedValueOnce(new Error('data process gone'));
    await sendSnapshot();
    expect(sent.some((r) => r.k === 'wl')).toBe(true);
  });
});
