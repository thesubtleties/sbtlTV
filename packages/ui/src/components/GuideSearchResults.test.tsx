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
  results, query: 'sports', activeIndex: -1, allChannels: false,
  onShowAllChannels: () => {}, onPickAiring: () => {}, onPickFeed: () => {}, onPickChannel: () => {}, ...over,
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
  it('says so when nothing matches', () => {
    const html = render({ results: { channels: [], channelTotal: 0, onNow: [], later: [], mentions: [] } });
    expect(html).toContain('Nothing on the guide for');
  });
});

describe('flattenResults', () => {
  it('lists rows in the order they show', () => {
    expect(flattenResults(results, false).map((i) => (i.kind === 'channel' ? i.channel.name : i.airing.title)))
      .toEqual(['Sports 1', 'Sports 2', 'Sports 3', 'Sports Tonight', 'Sports Later', 'Other']);
  });
});
