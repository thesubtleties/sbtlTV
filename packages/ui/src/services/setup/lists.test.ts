import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db, setLastCategory, getLastCategory } from '../../db';
import { readLists, replaceLists } from './lists';

beforeEach(async () => {
  await Promise.all([db.favorites.clear(), db.watchlist.clear(), db.watchProgress.clear(), db.prefs.clear()]);
});

describe('setup lists', () => {
  it('round-trips through JSON with dates intact', async () => {
    await db.favorites.put({ id: 'channel_s1_1', type: 'channel', stream_id: 's1_1', added: new Date('2026-10-01T10:00:00Z') });
    await db.watchProgress.put({ id: 'movie_s1_m1', type: 'movie', stream_id: 's1_m1', position: 60, duration: 600, progress: 0.1, completed: false, updated_at: new Date('2026-10-02T10:00:00Z') });
    await setLastCategory('s1_news');
    const lists = JSON.parse(JSON.stringify(await readLists(['favorites', 'progress'], true)));
    expect(lists.watchlist).toBeUndefined();
    await Promise.all([db.favorites.clear(), db.watchProgress.clear(), db.prefs.clear()]);
    await replaceLists(lists);
    const fav = await db.favorites.get('channel_s1_1');
    expect(fav?.added).toBeInstanceOf(Date);
    expect(fav?.added.toISOString()).toBe('2026-10-01T10:00:00.000Z');
    expect((await db.watchProgress.get('movie_s1_m1'))?.updated_at).toBeInstanceOf(Date);
    expect(await getLastCategory()).toBe('s1_news');
  });

  it('replacing clears what the file does not have', async () => {
    await db.watchlist.put({ id: 'movie_1', type: 'movie', tmdb_id: 1, name: 'Heat', added: new Date() });
    await setLastCategory('old');
    await replaceLists({ favorites: [] });
    expect(await db.watchlist.count()).toBe(0);
    expect(await getLastCategory()).toBeFalsy();
  });

  it('drops rows that are not rows', async () => {
    await replaceLists({ favorites: [null, 5, { id: 'channel_x', type: 'channel', stream_id: 'x', added: 'not a date' }, { type: 'channel' }] });
    const all = await db.favorites.toArray();
    expect(all.map((f) => f.id)).toEqual(['channel_x']);
    expect(all[0].added).toBeInstanceOf(Date);
  });
});

describe('R8 setup lists', () => {
  it('replacing clears every list, then writes every list the file has', async () => {
    await db.favorites.put({ id: 'channel_old', type: 'channel', stream_id: 'old', added: new Date() });
    await db.watchProgress.put({ id: 'movie_old', type: 'movie', stream_id: 'old', position: 1, duration: 2, progress: 0.5, completed: false, updated_at: new Date() });
    await replaceLists({ watchlist: [{ id: 'movie_2', type: 'movie', tmdb_id: 2, name: 'Alien', added: '2026-10-03T00:00:00.000Z' }] });
    expect(await db.favorites.count()).toBe(0);
    expect(await db.watchProgress.count()).toBe(0);
    expect((await db.watchlist.get('movie_2'))?.added).toBeInstanceOf(Date);
  });

  it('the last category rides only when asked for', async () => {
    await setLastCategory('s1_news');
    expect((await readLists(['favorites'], false)).lastCategory).toBeUndefined();
  });
});
