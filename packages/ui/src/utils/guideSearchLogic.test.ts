import { describe, it, expect } from 'vitest';
import type { GuideAiring } from '@sbtltv/core';
import type { GuideItem } from '../components/GuideSearchResults';
import { airingAction, enterItem, feedsAfterKey, jumpAnchor, moveActive, searchStatus } from './guideSearchLogic';

const ch = (n: number) => ({ stream_id: `c${n}`, name: `C${n}`, stream_icon: '' });
const airing = (channels: number, startMs = 1000): GuideAiring => ({
  key: 'k', title: 'T', description: '', startMs, endMs: startMs + 1000, programIds: [], channels: Array.from({ length: channels }, (_, i) => ch(i)),
});
const row = (a: GuideAiring): GuideItem => ({ id: `airing:${a.key}`, kind: 'airing', airing: a });

describe('moveActive', () => {
  it('moves one row at a time', () => {
    expect(moveActive(-1, 'ArrowDown', 3)).toBe(0);
    expect(moveActive(0, 'ArrowDown', 3)).toBe(1);
    expect(moveActive(1, 'ArrowUp', 3)).toBe(0);
  });
  it('stops at the last row, and Up from the first goes back to the box', () => {
    expect(moveActive(2, 'ArrowDown', 3)).toBe(2);
    expect(moveActive(0, 'ArrowUp', 3)).toBe(-1);
    expect(moveActive(-1, 'ArrowUp', 3)).toBe(-1);
  });
  it('stays in the box with no rows', () => {
    expect(moveActive(-1, 'ArrowDown', 0)).toBe(-1);
  });
});

describe('feedsAfterKey', () => {
  it('opens and closes the feeds of a row that has several', () => {
    expect(feedsAfterKey(row(airing(2)), 'ArrowRight')).toBe('k');
    expect(feedsAfterKey(row(airing(2)), 'ArrowLeft')).toBeNull();
  });
  it('leaves the key to the caret everywhere else', () => {
    expect(feedsAfterKey(undefined, 'ArrowRight')).toBeUndefined();
    expect(feedsAfterKey(row(airing(1)), 'ArrowRight')).toBeUndefined();
    expect(feedsAfterKey({ id: 'more', kind: 'more' }, 'ArrowLeft')).toBeUndefined();
    expect(feedsAfterKey({ id: 'channel:c', kind: 'channel', channel: ch(1) }, 'ArrowRight')).toBeUndefined();
  });
});

describe('enterItem', () => {
  const items: GuideItem[] = [row(airing(1)), { id: 'more', kind: 'more' }];
  it('takes the highlighted row, or the first if none', () => {
    expect(enterItem(items, 1, false)?.id).toBe('more');
    expect(enterItem(items, -1, false)?.id).toBe('airing:k');
  });
  it('does nothing on results that are not for what is typed', () => {
    expect(enterItem(items, 1, true)).toBeNull();
    expect(enterItem(items, -1, true)).toBeNull();
  });
  it('does nothing with no rows', () => {
    expect(enterItem([], -1, false)).toBeNull();
  });
});

describe('airingAction', () => {
  it('plays one channel on now, offers the feeds of several', () => {
    expect(airingAction(airing(1), 1000)).toBe('play');
    expect(airingAction(airing(2), 1000)).toBe('feeds');
  });
  it('jumps for later however many channels, deciding by the time of the pick', () => {
    expect(airingAction(airing(1), 999)).toBe('jump');
    expect(airingAction(airing(3), 999)).toBe('jump');
    expect(airingAction(airing(1, 1000), 1500)).toBe('play');   // a Later row that has started
  });
});

describe('jumpAnchor', () => {
  const at = (h: number, m: number, s = 0) => new Date(2026, 10, 5, h, m, s).getTime();
  it('starts the guide on the half hour the airing falls in', () => {
    expect(jumpAnchor(at(17, 0)).getTime()).toBe(at(17, 0));
    expect(jumpAnchor(at(17, 29, 59)).getTime()).toBe(at(17, 0));
    expect(jumpAnchor(at(17, 30)).getTime()).toBe(at(17, 30));
    expect(jumpAnchor(at(17, 59, 59)).getTime()).toBe(at(17, 30));
  });
});

describe('searchStatus', () => {
  const calm = { text: 'news', settled: 'news', active: true, stale: false, loading: false, hasData: true, error: false };
  it('is calm when the results are for what is typed', () => {
    expect(searchStatus(calm)).toEqual({ pending: false, failed: false });
  });
  it('is pending while typing, while the reply is for an older search, and before a first reply', () => {
    expect(searchStatus({ ...calm, text: 'newsy' }).pending).toBe(true);
    expect(searchStatus({ ...calm, stale: true }).pending).toBe(true);
    expect(searchStatus({ ...calm, loading: true, hasData: false }).pending).toBe(true);
  });
  it('is not pending on a background refresh of the same search', () => {
    expect(searchStatus({ ...calm, loading: true }).pending).toBe(false);
  });
  it('reports a failed search', () => {
    expect(searchStatus({ ...calm, error: true }).failed).toBe(true);
  });
  // FAILS on 13479b4: useDataQuery keeps `error` when the request goes idle, so after one failure
  // the next single letter typed shows "Search didn't work". Fix: failed: r.active && r.error.
  it('has no failure to show when no search is running', () => {
    expect(searchStatus({ ...calm, text: 'n', settled: 'n', active: false, error: true }).failed).toBe(false);
  });
});
