import { describe, it, expect } from 'vitest';
import type { GuideAiring } from '@sbtltv/core';
import type { GuideItem } from '../components/GuideSearchResults';
import { airingAction, enterItem, expandAfterKey, jumpAnchor, moveActive, searchStatus } from './guideSearchLogic';

const ch = (n: number) => ({ stream_id: `c${n}`, name: `C${n}`, stream_icon: '' });
const airing = (channels: number, startMs = 1000): GuideAiring => ({
  key: 'k', title: 'T', description: '', startMs, endMs: startMs + 1000, programIds: [], channels: Array.from({ length: channels }, (_, i) => ch(i)),
});
const row = (a: GuideAiring): GuideItem => ({ id: `airing:${a.key}`, kind: 'airing', airing: a });

const a1 = row({ ...airing(1), key: 'a' });
const b1 = row({ ...airing(1), key: 'b' });
const c1 = row({ ...airing(1), key: 'c' });
const list = [a1, b1, c1];

describe('moveActive', () => {
  it('moves one row at a time, by row, not position', () => {
    expect(moveActive(null, 'ArrowDown', list)).toBe('airing:a');
    expect(moveActive('airing:a', 'ArrowDown', list)).toBe('airing:b');
    expect(moveActive('airing:b', 'ArrowUp', list)).toBe('airing:a');
  });
  it('stops at the last row, and Up from the first goes back to the box', () => {
    expect(moveActive('airing:c', 'ArrowDown', list)).toBe('airing:c');
    expect(moveActive('airing:a', 'ArrowUp', list)).toBeNull();
    expect(moveActive(null, 'ArrowUp', list)).toBeNull();
  });
  it('stays in the box with no rows', () => {
    expect(moveActive(null, 'ArrowDown', [])).toBeNull();
  });
  it('starts over when the highlighted row has gone', () => {
    expect(moveActive('airing:gone', 'ArrowDown', list)).toBe('airing:a');
  });
});

describe('expandAfterKey', () => {
  it('opens a row with feeds or other airings', () => {
    expect(expandAfterKey(row(airing(2)), 'ArrowRight', null)).toBe('k');
    expect(expandAfterKey(row({ ...airing(1), more: [airing(1)] }), 'ArrowRight', null)).toBe('k');
  });
  it('closes whatever is open from anywhere inside it', () => {
    expect(expandAfterKey(row(airing(2)), 'ArrowLeft', 'k')).toBeNull();
    expect(expandAfterKey({ id: 'feed:k:c1', kind: 'feed', airing: airing(2), channel: ch(1) }, 'ArrowLeft', 'k')).toBeNull();
  });
  it('leaves the key to the caret everywhere else', () => {
    expect(expandAfterKey(undefined, 'ArrowRight', null)).toBeUndefined();
    expect(expandAfterKey(row(airing(1)), 'ArrowRight', null)).toBeUndefined();
    expect(expandAfterKey(row(airing(2)), 'ArrowLeft', null)).toBeUndefined();
    expect(expandAfterKey({ id: 'more', kind: 'more' }, 'ArrowLeft', null)).toBeUndefined();
    expect(expandAfterKey({ id: 'channel:c', kind: 'channel', channel: ch(1) }, 'ArrowRight', null)).toBeUndefined();
  });
});

describe('enterItem', () => {
  const items: GuideItem[] = [row(airing(1)), { id: 'more', kind: 'more' }];
  it('takes the highlighted row, or the first if none', () => {
    expect(enterItem(items, 'more', false)?.id).toBe('more');
    expect(enterItem(items, null, false)?.id).toBe('airing:k');
  });
  it('does nothing on results that are not for what is typed', () => {
    expect(enterItem(items, 'more', true)).toBeNull();
    expect(enterItem(items, null, true)).toBeNull();
    expect(enterItem(items, null, true)).toBeNull();
  });
  it('does nothing with no rows', () => {
    expect(enterItem([], -1, false)).toBeNull();
  });
});

describe('enterItem when the highlighted row has gone', () => {
  it('does nothing, rather than act on the first row', () => {
    expect(enterItem([row(airing(1))], 'airing:ended', false)).toBeNull();
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
