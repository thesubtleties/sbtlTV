import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GuideSearchResult } from '@sbtltv/core';
import { GuideSearchResults, flattenResults } from './GuideSearchResults';

const ch = (n: number) => ({ stream_id: `c${n}`, name: `Sports ${n}`, stream_icon: '' });
const airing = (title: string, startMs: number) => ({ key: title, title, description: 'about sports here', startMs, endMs: startMs + 3600000, channels: [ch(1), ch(2)], programIds: [] });
const results: GuideSearchResult = {
  channels: [ch(1), ch(2), ch(3), ch(4)], channelTotal: 4,
  onNow: [airing('Sports Tonight', Date.now() - 60000)], later: [airing('Sports Later', Date.now() + 3600000)], mentions: [airing('Other', Date.now() + 7200000)],
};
const render = (over = {}) => renderToStaticMarkup(createElement(GuideSearchResults, {
  results, query: 'sports', activeId: null, allChannels: false, expandedKey: null,
  onShowAllChannels: () => {}, onToggleFeeds: () => {}, onPickAiring: () => {}, onPickFeed: () => {}, onPickChannel: () => {}, ...over,
}));

describe('GuideSearchResults', () => {
  it('shows the sections in order, with 3 channels and a way to the rest', () => {
    const html = render();
    expect(html.indexOf('Channels')).toBeLessThan(html.indexOf('On now'));
    expect(html.indexOf('On now')).toBeLessThan(html.indexOf('Later'));
    expect(html.indexOf('Later')).toBeLessThan(html.indexOf('Also mentions'));
    expect(html).toContain('Show all 4');
    expect(html).not.toContain('Sports</mark> 4');
  });
  it('shows every channel once expanded, and no link', () => {
    const html = render({ allChannels: true });
    expect(html).toContain('Sports</mark> 4');
    expect(html).not.toContain('Show all');
  });
  it('is honest when there are more channels than it will list', () => {
    const many = { ...results, channels: Array.from({ length: 200 }, (_, i) => ch(i)), channelTotal: 1200 };
    expect(render({ results: many })).toContain('Show 200 of 1200');
    expect(render({ results: many, allChannels: true })).toContain('200 of 1200 shown');
  });
  it('says so when nothing matches', () => {
    const html = render({ results: { channels: [], channelTotal: 0, onNow: [], later: [], mentions: [] } });
    expect(html).toContain('Nothing on the guide for');
  });
  it('lists the feeds of the expanded airing', () => {
    expect(render({ expandedKey: 'Sports Tonight' })).toContain('gsr-feed');
    expect(render()).not.toContain('gsr-feed');
  });
  it('marks the active row', () => {
    expect(render({ activeId: 'airing:Sports Tonight' })).toContain('gsr-row--active');
  });
  it('highlights accented matches', () => {
    const r = { ...results, onNow: [airing('Fútbol Liga', Date.now() - 60000)] };
    expect(render({ results: r, query: 'futb' })).toContain('<mark>Fútbol</mark>');
  });
});

describe('flattenResults', () => {
  const names = (items: ReturnType<typeof flattenResults>) => items.map((i) => i.id);
  it('lists rows in the order they show, Show all included', () => {
    expect(names(flattenResults(results, false, null))).toEqual([
      'channel:c1', 'channel:c2', 'channel:c3', 'more', 'airing:Sports Tonight', 'airing:Sports Later', 'airing:Other',
    ]);
  });
  it('has no Show all once expanded or when everything shows', () => {
    expect(names(flattenResults(results, true, null))).not.toContain('more');
  });
  it('puts open feeds right after their airing', () => {
    const ids = names(flattenResults(results, false, 'Sports Later'));
    expect(ids.slice(ids.indexOf('airing:Sports Later'), ids.indexOf('airing:Other'))).toEqual([
      'airing:Sports Later', 'feed:Sports Later:c1', 'feed:Sports Later:c2',
    ]);
  });
});

describe('GuideSearchResults: no way to the rest when there is no rest', () => {
  const three = { ...results, channels: [ch(1), ch(2), ch(3)], channelTotal: 3 };
  it('has no Show all row for the keyboard to land on', () => {
    expect(flattenResults(three, false, null).map((i) => i.id)).not.toContain('more');
  });
  it('has no Show all button', () => {
    expect(render({ results: three })).not.toContain('Show all');
  });
});

describe('GuideSearchResults: times and mentions', () => {
  const noon = new Date(2026, 10, 5, 12, 0).getTime();
  const hour = 3600000;
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(noon); });
  afterEach(() => { vi.useRealTimers(); });
  const only = (over: Partial<GuideSearchResult>): GuideSearchResult => ({ channels: [], channelTotal: 0, onNow: [], later: [], mentions: [], ...over });

  it('names today and tomorrow, then the weekday', () => {
    const at = (ms: number) => render({ results: only({ later: [airing('Sports', ms)] }) });
    expect(at(noon + 2 * hour)).toContain('Today');
    expect(at(noon + 24 * hour)).toContain('Tomorrow');
    expect(at(noon + 48 * hour)).toContain(new Date(noon + 48 * hour).toLocaleDateString([], { weekday: 'long' }));
  });
  it('says how long is left in hours and minutes', () => {
    const on = { ...airing('Sports', noon - hour), endMs: noon + 90 * 60000 };
    expect(render({ results: only({ onNow: [on] }) })).toContain('1h 30m left');
  });
  it('shows the part of a description around a word deep in it', () => {
    const long = `${'lorem ipsum '.repeat(20)}and then the sports begin`;
    const html = render({ results: only({ mentions: [{ ...airing('Other', noon + hour), description: long }] }) });
    expect(html).toContain('<mark>sports</mark> begin');
    expect(html).toContain('…');
    expect(html.match(/lorem/g)!.length).toBeLessThan(10);
  });
});

describe('a show with other airings', () => {
  const later = { ...airing('Sports Later', Date.now() + 3600000), more: [airing('Sports Later', Date.now() + 7200000), airing('Sports Later', Date.now() + 9000000)] };
  later.more[0].key = 'm1'; later.more[1].key = 'm2';
  const r = { ...results, later: [later] };
  it('says how many, as well as how many channels', () => {
    const html = render({ results: r });
    expect(html).toContain('2 more');
    expect(html).toContain('2 channels');
  });
  it('lists them when opened', () => {
    expect(render({ results: r, expandedKey: 'Sports Later' })).toContain('data-row="airing:m1"');
    expect(render({ results: r })).not.toContain('data-row="airing:m1"');
  });
  it('lets the keys reach them, after its feeds', () => {
    const ids = flattenResults(r, false, 'Sports Later').map((i) => i.id);
    expect(ids.slice(ids.indexOf('airing:Sports Later'), ids.indexOf('airing:Other'))).toEqual([
      'airing:Sports Later', 'feed:Sports Later:c1', 'feed:Sports Later:c2', 'airing:m1', 'airing:m2',
    ]);
  });
});

describe('rows found by their description', () => {
  it('name the channel beside the words that matched', () => {
    const a = { ...airing('Other', Date.now() - 1000), byDescription: true };
    const html = render({ results: { ...results, onNow: [a] } });
    expect(html).toContain('Sports 1 · ');
    expect(html).toContain('<mark>sports</mark> here');
  });
});
