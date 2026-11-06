import { describe, it, expect } from 'vitest';
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
