import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncRecord } from '@sbtltv/core';
import { db } from '../../db';
import { useUIStore } from '../../stores/uiStore';
import { toggleFavoriteChannel } from '../../hooks/useFavorites';
import { sendSnapshot, setSyncActive } from './outbox';

vi.mock('../../data/client', () => ({
  data: {
    query: vi.fn(async (req: { type: string; streamIds?: string[] }) => (req.type === 'channelsByIds'
      ? [{ stream_id: 'm1_77', source_id: 'm1', name: 'ESPN', epg_channel_id: 'ESPN.us' }].filter((c) => req.streamIds?.includes(c.stream_id))
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
    await db.favorites.put({ id: 'channel_m1_77', type: 'channel', stream_id: 'm1_77', name: 'ESPN', added: new Date(1), sync: { host: 'other.example', ch: '5' } });
    await toggleFavoriteChannel('m1_77', 'ESPN');
    expect(sent).toEqual([expect.objectContaining({ k: 'fav', host: 'other.example', ch: '5', removed: true })]);
  });
  it('the snapshot includes channel favorites, also ones waiting for their channel', async () => {
    await db.favorites.bulkPut([
      { id: 'channel_m1_77', type: 'channel', stream_id: 'm1_77', name: 'ESPN', added: new Date(1) },
      { id: 'channel_sync_x.example_9', type: 'channel', name: 'Waiting', added: new Date(1), sync: { host: 'x.example', ch: '9' } },
    ]);
    await sendSnapshot();
    expect(sent.filter((r) => r.k === 'fav').map((r) => (r as { host: string; ch: string }).host + ':' + (r as { ch: string }).ch).sort()).toEqual(['provider.example:77', 'x.example:9']);
  });
});
