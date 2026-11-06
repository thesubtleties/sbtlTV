import { describe, it, expect } from 'vitest';
import { groupAirings, isAdultCategoryName, isAiringLive, isTitleMatch, toFtsQuery, type GuideSearchRow } from './guide-search';

const row = (over: Partial<GuideSearchRow>): GuideSearchRow => ({
  id: 'p1', title: 'Football Night', description: '', start: 1000, end: 2000, rank: -5,
  stream_id: 's1', channel_name: 'CBS', stream_icon: '', ...over,
});

describe('toFtsQuery', () => {
  it('makes every word a quoted prefix', () => {
    expect(toFtsQuery('man utd')).toBe('"man"* "utd"*');
  });
  it('turns symbols into plain text, never syntax', () => {
    expect(toFtsQuery('c++')).toBeNull();   // one letter once the symbols go
    expect(toFtsQuery('AT&T')).toBe('"at"* "t"*');
    expect(toFtsQuery('"quoted" (x) NOT -y')).toBe('"quoted"* "x"* "not"* "y"*');
  });
  it('is null for nothing searchable or a single letter', () => {
    expect(toFtsQuery('')).toBeNull();
    expect(toFtsQuery('  ')).toBeNull();
    expect(toFtsQuery('***')).toBeNull();
    expect(toFtsQuery('a')).toBeNull();
  });
  it('keeps non-Latin letters', () => {
    expect(toFtsQuery('fútbol 東京')).toBe('"fútbol"* "東京"*');
  });
});

describe('isTitleMatch', () => {
  it('needs every word as a word start, ignoring accents and case', () => {
    expect(isTitleMatch('Fútbol Liga', 'futb lig')).toBe(true);
    expect(isTitleMatch('The Big Show', 'big news')).toBe(false);
    expect(isTitleMatch('Superbowl', 'bowl')).toBe(false);
  });
});

describe('isAdultCategoryName', () => {
  it('matches the real category names', () => {
    for (const n of ['24/7 Adult', 'Adults', 'Adults (18+)', 'Adults 24-7', 'VOD Adults', 'XXX Live', '18+ Only']) {
      expect(isAdultCategoryName(n)).toBe(true);
    }
  });
  it('leaves ordinary and near-miss names alone', () => {
    for (const n of ['Adult Swim', 'Young Adult Movies', 'USA Sports', 'UK: Kids', 'Top 18 Rugby', 'Saxxon TV']) {
      expect(isAdultCategoryName(n)).toBe(n === 'Young Adult Movies');
    }
  });
});

describe('isAiringLive', () => {
  it('is live from its start time', () => {
    expect(isAiringLive({ startMs: 100 }, 99)).toBe(false);
    expect(isAiringLive({ startMs: 100 }, 100)).toBe(true);
  });
});

describe('groupAirings', () => {
  it('makes one airing per title and start, with each channel once', () => {
    const out = groupAirings([
      row({ id: 'a', stream_id: 's1', channel_name: 'CBS' }),
      row({ id: 'b', stream_id: 's2', channel_name: 'CBS HD' }),
      row({ id: 'c', stream_id: 's2', channel_name: 'CBS HD' }),
    ], 'football', 1500);
    expect(out.onNow).toHaveLength(1);
    expect(out.onNow[0].channels.map((c) => c.stream_id)).toEqual(['s1', 's2']);
    expect(out.onNow[0].programIds).toEqual(['a', 'b', 'c']);
  });
  it('splits on now, later and description mentions', () => {
    const out = groupAirings([
      row({ id: 'now', start: 1000, end: 3000 }),
      row({ id: 'soon', title: 'Football Late', start: 5000, end: 6000 }),
      row({ id: 'desc', title: 'Sunday Show', description: 'all the football', start: 900, end: 3000 }),
    ], 'football', 2000);
    expect(out.onNow.map((a) => a.title)).toEqual(['Football Night']);
    expect(out.later.map((a) => a.title)).toEqual(['Football Late']);
    expect(out.mentions.map((a) => a.title)).toEqual(['Sunday Show']);
  });
  it('sorts on now by relevance, later by time, mentions on now first', () => {
    const out = groupAirings([
      row({ id: '1', title: 'Football A', rank: -1, start: 100, end: 9000 }),
      row({ id: '2', title: 'Football B', rank: -9, start: 100, end: 9000 }),
      row({ id: '3', title: 'Football C', start: 8000, end: 9000 }),
      row({ id: '4', title: 'Football D', start: 7000, end: 9000 }),
      row({ id: '5', title: 'M later', description: 'football', start: 7000, end: 9000 }),
      row({ id: '6', title: 'M now', description: 'football', start: 100, end: 9000 }),
    ], 'football', 500);
    expect(out.onNow.map((a) => a.title)).toEqual(['Football B', 'Football A']);
    expect(out.later.map((a) => a.title)).toEqual(['Football D', 'Football C']);
    expect(out.mentions.map((a) => a.title)).toEqual(['M now', 'M later']);
  });
});
