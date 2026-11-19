import { describe, expect, it } from 'vitest';
import { baseVersion, compareVersions, whatsNewToShow } from './whatsNew';
import type { WhatsNewItem } from '../whatsNewItems';

const item: WhatsNewItem = { id: 'sync', title: 'Sync', text: 'x' };
const items = { '0.17.0': [item] };
const s = { current: '0.17.0', lastSeen: '0.16.0', buildKind: 'release', hasSources: true, firstRun: null, items } as const;

describe('compareVersions', () => {
  it('orders numbers and prereleases', () => {
    expect(compareVersions('0.17.0', '0.16.9')).toBeGreaterThan(0);
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('0.17.0-beta.1', '0.17.0')).toBeLessThan(0);
    expect(compareVersions('0.17.0-beta.10', '0.17.0-beta.2')).toBeGreaterThan(0);
    expect(compareVersions('0.17.0', '0.17.0')).toBe(0);
    expect(baseVersion('0.17.0-beta.3')).toBe('0.17.0');
  });
});

describe('whatsNewToShow', () => {
  it('shows the new version items once after an update', () => {
    expect(whatsNewToShow(s)).toEqual([item]);
    expect(whatsNewToShow({ ...s, lastSeen: '0.17.0' })).toBe(null);
  });
  it('a beta and its stable share one list: shown once across beta.1, beta.2 and 0.17.0', () => {
    expect(whatsNewToShow({ ...s, current: '0.17.0-beta.1' })).toEqual([item]);
    expect(whatsNewToShow({ ...s, current: '0.17.0-beta.2', lastSeen: '0.17.0-beta.1' })).toBe(null);
    expect(whatsNewToShow({ ...s, current: '0.17.0', lastSeen: '0.17.0-beta.2' })).toBe(null);
  });
  it('skipped versions see only the current list', () => {
    expect(whatsNewToShow({ ...s, lastSeen: '0.14.0' })).toEqual([item]);
  });
  it('never on test or local builds', () => {
    expect(whatsNewToShow({ ...s, buildKind: 'test' })).toBe(null);
    expect(whatsNewToShow({ ...s, buildKind: 'local' })).toBe(null);
  });
  it('never on a fresh install (the first run is showing, or no sources and nothing seen)', () => {
    expect(whatsNewToShow({ ...s, firstRun: 'setup', lastSeen: undefined, hasSources: false })).toBe(null);
    expect(whatsNewToShow({ ...s, lastSeen: undefined, hasSources: false })).toBe(null);
  });
  it('an update from 0.16 or older (no marker yet, has sources) counts as updated', () => {
    expect(whatsNewToShow({ ...s, lastSeen: undefined })).toEqual([item]);
  });
  it('a version without items shows nothing', () => {
    expect(whatsNewToShow({ ...s, current: '0.17.1', lastSeen: '0.17.0' })).toBe(null);
  });
});

import { whatsNewOnLaunch } from './whatsNew';
import { WHATS_NEW } from '../whatsNewItems';

describe('whatsNewOnLaunch', () => {
  it('shows the list after an update', () => {
    expect(whatsNewOnLaunch(s)).toEqual({ show: [item] });
  });
  it('a release with nothing to show records the version, so the next update compares from here', () => {
    expect(whatsNewOnLaunch({ ...s, current: '0.17.1', lastSeen: '0.17.0' })).toBe('record');
    expect(whatsNewOnLaunch({ ...s, current: '0.17.0', lastSeen: '0.17.0-beta.2' })).toBe('record');
  });
  it('records nothing when already up to date, on test or local builds, or while the first run is open', () => {
    expect(whatsNewOnLaunch({ ...s, lastSeen: '0.17.0' })).toBe(null);
    expect(whatsNewOnLaunch({ ...s, current: '0.17.1', buildKind: 'test' })).toBe(null);
    expect(whatsNewOnLaunch({ ...s, current: '0.17.1', buildKind: 'local' })).toBe(null);
    expect(whatsNewOnLaunch({ ...s, current: '0.17.1', firstRun: 'setup' })).toBe(null);
    expect(whatsNewOnLaunch({ ...s, current: '0.17.1', firstRun: 'offer-sync' })).toBe(null);
  });
});

describe('WHATS_NEW', () => {
  it('is keyed by release versions (a beta key would never be looked up) and every list has items', () => {
    for (const [v, list] of Object.entries(WHATS_NEW)) {
      expect(v).toMatch(/^\d+\.\d+\.\d+$/);
      expect(list.length).toBeGreaterThan(0);
      expect(new Set(list.map((i) => i.id)).size).toBe(list.length);
    }
  });
});

import { latestList, whatsNewOnLaunch as onLaunch } from './whatsNew';

describe('versions without their own list', () => {
  const lists = { '0.17.0': [item], '0.15.0': [{ ...item, id: 'old' }] };
  it('a patch release still shows the newest list not seen yet', () => {
    expect(whatsNewToShow({ ...s, items: lists, current: '0.17.1', lastSeen: '0.16.0' })).toEqual([item]);
    expect(whatsNewToShow({ ...s, items: lists, current: '0.17.2', lastSeen: '0.17.1' })).toBe(null);
    expect(whatsNewToShow({ ...s, items: lists, current: '0.17.1', lastSeen: undefined })).toEqual([item]);
  });
  it('About shows the newest list up to this version', () => {
    expect(latestList(lists, '0.17.3')).toEqual([item]);
    expect(latestList(lists, '0.16.0')).toEqual([{ ...item, id: 'old' }]);
    expect(latestList(lists, '0.14.0')).toBe(null);
  });
  it('a beta with nothing to show never records itself as seen (its list may come in a later beta)', () => {
    expect(onLaunch({ ...s, items: {}, current: '0.18.0-beta.1', lastSeen: '0.17.0' })).toBe(null);
    expect(onLaunch({ ...s, items: {}, current: '0.18.0', lastSeen: '0.17.0' })).toBe('record');
  });
  it('every list is keyed by a plain X.Y.Z version', () => {
    for (const key of Object.keys(WHATS_NEW)) expect(key).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('the real 0.17.0 list', () => {
  const real = { current: '0.17.0', lastSeen: '0.16.0', buildKind: 'release', hasSources: true, firstRun: null, items: WHATS_NEW } as const;
  const ids = (r: ReturnType<typeof whatsNewToShow>) => (r ?? []).map((i) => i.id);
  it('an update from 0.16 to 0.17.0 shows Sync and the rest of the release', () => {
    expect(ids(whatsNewToShow(real))).toEqual(['sync', 'send', 'more-like-this', 'vod-header', 'loading-screen']);
    // From 0.16.0 before the version marker existed (no lastSeen, has sources): the same list
    expect(ids(whatsNewToShow({ ...real, lastSeen: undefined }))).toEqual(['sync', 'send', 'more-like-this', 'vod-header', 'loading-screen']);
  });
  it('a beta shows the same list; once seen on a beta, 0.17.0 does not show it again', () => {
    expect(ids(whatsNewToShow({ ...real, current: '0.17.0-beta.2' }))).toContain('sync');
    expect(whatsNewToShow({ ...real, lastSeen: '0.17.0-beta.1' })).toBe(null);
  });
});
