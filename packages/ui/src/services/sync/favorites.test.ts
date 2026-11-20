import { describe, expect, it } from 'vitest';
import { channelPart, favoriteRecord, matchFavorite, sourceHost } from './favorites';

const ch = (stream_id: string, source_id: string, name: string, epg = '', num: number | null = null) => ({ stream_id, source_id, name, channel_num: num, guides: epg ? [epg] : [] });

describe('favorite identity', () => {
  it('host is the server name only', () => {
    expect(sourceHost({ url: 'http://User:pw@Provider.Example:8080/get.php?x=1' })).toBe('provider.example');
    expect(sourceHost({ url: 'imported:My list' })).toBe('file');
    expect(sourceHost({ url: 'not a url' })).toBe('file');
  });
  it("channel id without this computer's source prefix", () => {
    expect(channelPart('abc-123_4567', 'abc-123')).toBe('4567');
    expect(channelPart('other_4567', 'abc-123')).toBe('other_4567');
  });
  it('records carry the guide id only when there is one', () => {
    expect(favoriteRecord({ host: 'p.example', ch: '1', guide: '', name: 'X' }, 5)).toEqual({ k: 'fav', host: 'p.example', ch: '1', name: 'X', at: 5 });
    expect(favoriteRecord({ host: 'p.example', ch: '1', name: 'X' }, 5, true)).toEqual({ k: 'fav', host: 'p.example', ch: '1', name: 'X', at: 5, removed: true });
  });
});

describe('matchFavorite', () => {
  const sources = [{ id: 'm1', url: 'http://provider.example' }, { id: 'm2', url: 'http://other.example' }];
  const rec = { host: 'provider.example', ch: '1234', guide: 'CNN.us', name: 'CNN HD' };
  it('same provider and channel first', () => {
    const byId = new Map([['m1_1234', ch('m1_1234', 'm1', 'US: CNN')]]);
    expect(matchFavorite(rec, { sources, byId, byGuide: [ch('m2_9', 'm2', 'CNN HD', 'CNN.us')] })).toBe('m1_1234');
  });
  it('else the guide id, closest name, then lowest number (one of HD/SD/backup)', () => {
    const byGuide = [ch('m2_8', 'm2', 'CNN SD', 'CNN.us', 3), ch('m2_9', 'm2', 'CNN HD', 'CNN.us', 7), ch('m2_7', 'm2', 'CNN Backup', 'CNN.us', 1)];
    expect(matchFavorite(rec, { sources, byId: new Map(), byGuide })).toBe('m2_9');
    expect(matchFavorite({ ...rec, name: 'cnn-hd' }, { sources, byId: new Map(), byGuide })).toBe('m2_9');
    // Several channels share the guide id and none is named like it: no guess ("PPV Fight Night" on "Event 0")
    expect(matchFavorite({ ...rec, name: 'Something else' }, { sources, byId: new Map(), byGuide })).toBe(null);
    // The only channel with that guide id: taken whatever its name
    expect(matchFavorite({ ...rec, name: 'Something else' }, { sources, byId: new Map(), byGuide: [byGuide[0]] })).toBe('m2_8');
  });
  it('name ranking: exact, then same letters, then containing the name; a channel without a number comes after numbered ones', () => {
    const m = (name: string, byGuide: ReturnType<typeof ch>[]) => matchFavorite({ ...rec, host: 'x.example', name }, { sources, byId: new Map(), byGuide });
    expect(m('CNN HD', [ch('m2_1', 'm2', 'cnn hd', 'CNN.us', 1), ch('m2_2', 'm2', 'CNN HD', 'CNN.us', 9)])).toBe('m2_2');
    expect(m('CNN', [ch('m2_1', 'm2', 'Other', 'CNN.us', 1), ch('m2_2', 'm2', 'US: CNN HD', 'CNN.us', 9)])).toBe('m2_2');
    expect(m('News', [ch('m2_1', 'm2', 'News A', 'CNN.us', null), ch('m2_2', 'm2', 'News B', 'CNN.us', 40)])).toBe('m2_2');
  });
  it('a source not passed in (disabled) is never a match', () => {
    const byId = new Map([['m3_1234', ch('m3_1234', 'm3', 'CNN')]]);
    expect(matchFavorite(rec, { sources: [{ id: 'm3', url: 'http://elsewhere.example' }], byId, byGuide: [] })).toBe(null);
    expect(matchFavorite(rec, { sources: [], byId: new Map(), byGuide: [ch('m2_9', 'm2', 'CNN HD', 'CNN.us')] })).toBe(null);
  });
  it('no guide id and no same channel: unmatched', () => {
    expect(matchFavorite({ host: 'x.example', ch: '1', name: 'A' }, { sources, byId: new Map(), byGuide: [] })).toBe(null);
  });
});

import { favoriteIds, localId, waitingFavorites, withId } from './favorites';

describe('the ids a favorite answers to', () => {
  const sources = [{ id: 'm1', url: 'http://provider.example' }];
  it('its saved ids, even on a different local channel (Review Focus 4); else its own channel\'s', () => {
    expect(favoriteIds({ stream_id: 'm2_9', ids: [{ host: 'provider.example', ch: '1234' }] }, sources)).toEqual([{ host: 'provider.example', ch: '1234' }]);
    expect(favoriteIds({ stream_id: 'm1_77' }, sources)).toEqual([{ host: 'provider.example', ch: '77' }]);
    expect(favoriteIds({ stream_id: 'zz_77' }, sources)).toEqual([]);
  });
  it('its own id from the source in its channel id, with the guide id when known', () => {
    expect(localId('m1_77', sources, 'ESPN.us')).toEqual({ host: 'provider.example', ch: '77', guide: 'ESPN.us' });
    expect(localId('m9_77', sources)).toBe(null);
  });
  it('adding an id keeps one per key, the newest', () => {
    expect(withId([{ host: 'a', ch: '1', guide: 'x' }, { host: 'b', ch: '2' }], { host: 'a', ch: '1', guide: 'y' })).toEqual([{ host: 'b', ch: '2' }, { host: 'a', ch: '1', guide: 'y' }]);
  });
  it('only favorites from other computers with no channel here are shown grayed, and only with Gray out', () => {
    const rows = [{ ids: [{ host: 'h', ch: '1' }] }, { stream_id: 'm1_2', ids: [{ host: 'h', ch: '2' }] }, { stream_id: 'm1_3' }];
    expect(waitingFavorites(rows, 'gray')).toEqual([rows[0]]);
    expect(waitingFavorites(rows, 'hide')).toEqual([]);
  });
});

describe('server names', () => {
  it('"www." is dropped and IPv6 addresses keep their brackets', () => {
    expect(sourceHost({ url: 'https://www.Provider.example/x' })).toBe('provider.example');
    expect(sourceHost({ url: 'http://[fd00::5]:8080/' })).toBe('[fd00::5]');
  });
  it('names in any script compare by their letters', () => {
    const c = (id: string, name: string) => ({ stream_id: id, source_id: 'm2', name, channel_num: null, guides: ['ru.1'] });
    expect(matchFavorite({ host: 'x', ch: '1', guide: 'ru.1', name: 'Первый канал HD' }, { sources: [{ id: 'm2', url: 'http://o.example' }], byId: new Map(), byGuide: [c('m2_1', 'Россия'), c('m2_2', 'ПЕРВЫЙ КАНАЛ')] })).toBe('m2_2');
  });
});
