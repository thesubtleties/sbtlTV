import { describe, expect, it } from 'vitest';
import { channelPart, favoriteRecord, matchFavorite, sourceHost } from './favorites';

const ch = (stream_id: string, source_id: string, name: string, epg = '', num: number | null = null) => ({ stream_id, source_id, name, channel_num: num, epg_channel_id: epg });

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
    expect(matchFavorite({ ...rec, name: 'Something else' }, { sources, byId: new Map(), byGuide })).toBe('m2_7');
  });
  it('name ranking: exact, then same letters, then containing the name; a channel without a number comes after numbered ones', () => {
    const m = (name: string, byGuide: ReturnType<typeof ch>[]) => matchFavorite({ ...rec, host: 'x.example', name }, { sources, byId: new Map(), byGuide });
    expect(m('CNN HD', [ch('m2_1', 'm2', 'cnn hd', 'CNN.us', 1), ch('m2_2', 'm2', 'CNN HD', 'CNN.us', 9)])).toBe('m2_2');
    expect(m('CNN', [ch('m2_1', 'm2', 'Other', 'CNN.us', 1), ch('m2_2', 'm2', 'US: CNN HD', 'CNN.us', 9)])).toBe('m2_2');
    expect(m('Zzz', [ch('m2_1', 'm2', 'A', 'CNN.us', null), ch('m2_2', 'm2', 'B', 'CNN.us', 40)])).toBe('m2_2');
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

import { favoriteIdentity } from './favorites';

describe('favoriteIdentity (what goes out)', () => {
  const sources = [{ id: 'm1', url: 'http://provider.example' }];
  it('a favorite that came through Sync keeps the key it came with, even on a different local channel (Review Focus 4)', () => {
    const row = { stream_id: 'm2_9', sync: { host: 'provider.example', ch: '1234', guide: 'CNN.us' } };
    expect(favoriteIdentity(row, { sources, channel: { source_id: 'm2', epg_channel_id: 'CNN.us' } })).toEqual({ host: 'provider.example', ch: '1234', guide: 'CNN.us' });
  });
  it("a local favorite: its source's server, the channel id without the prefix, and its guide id", () => {
    expect(favoriteIdentity({ stream_id: 'm1_77' }, { sources, channel: { source_id: 'm1', epg_channel_id: 'ESPN.us' } })).toEqual({ host: 'provider.example', ch: '77', guide: 'ESPN.us' });
    expect(favoriteIdentity({ stream_id: 'm1_77' }, { sources, channel: { source_id: 'm1', epg_channel_id: '' } })).toEqual({ host: 'provider.example', ch: '77' });
  });
  it('unknown channel or source: nothing to send', () => {
    expect(favoriteIdentity({ stream_id: 'm1_77' }, { sources })).toBe(null);
    expect(favoriteIdentity({ stream_id: 'zz_77' }, { sources, channel: { source_id: 'zz', epg_channel_id: '' } })).toBe(null);
  });
});
