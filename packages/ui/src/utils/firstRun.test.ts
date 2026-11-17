import { describe, expect, it } from 'vitest';
import { afterReceive, firstRunMode, isOptional, nextStep, prevStep, STEPS } from './firstRun';

const base = { settingsLoaded: true, sourcesLoaded: true, sourceCount: 0, marker: undefined } as const;

describe('firstRunMode', () => {
  it('waits until settings and sources are read', () => {
    expect(firstRunMode({ ...base, settingsLoaded: false })).toBe(null);
    expect(firstRunMode({ ...base, sourcesLoaded: false })).toBe(null);
  });
  it('a computer with no sources and no marker gets the setup (also after quitting half way)', () => {
    expect(firstRunMode(base)).toBe('setup');
  });
  it('anyone with a source never sees it', () => {
    expect(firstRunMode({ ...base, sourceCount: 1 })).toBe(null);
  });
  it('done is for good, even with no sources', () => {
    expect(firstRunMode({ ...base, marker: 'done' })).toBe(null);
  });
  it('an offer with no source (the apply failed, or the setup had no sources) is the setup again', () => {
    expect(firstRunMode({ ...base, sourceCount: 0, marker: 'offer-sync' })).toBe('setup');
  });
  it('after a received setup it offers sync once', () => {
    expect(firstRunMode({ ...base, sourceCount: 2, marker: 'offer-sync' })).toBe('offer-sync');
  });
});

describe('steps', () => {
  it('walk forward and back, clamped at both ends', () => {
    expect(nextStep('welcome')).toBe('source');
    expect(nextStep('sync')).toBe('done');
    expect(nextStep('done')).toBe('done');
    expect(prevStep('source')).toBe('welcome');
    expect(prevStep('welcome')).toBe('welcome');
  });
  it('only TMDB, subtitles and sync can be skipped', () => {
    expect(STEPS.filter((s) => isOptional(s))).toEqual(['tmdb', 'subtitles', 'sync']);
  });
  it('a received setup restarts; a received join still needs a source', () => {
    expect(afterReceive('setup')).toBe('restart');
    expect(afterReceive('join')).toBe('source');
  });
});

import { receiveViewCloses, stepAfterJoin, wrapFocus } from './firstRun';

describe('receive view', () => {
  it('closes when a received setup or join is declined, not while one is arriving or applying', () => {
    expect(receiveViewCloses('preview', 'idle')).toBe(true);
    expect(receiveViewCloses('join', 'idle')).toBe(true);
    expect(receiveViewCloses('failed', 'idle')).toBe(true);
    expect(receiveViewCloses('idle', 'preview')).toBe(false);
    expect(receiveViewCloses('preview', 'applying')).toBe(false);
    expect(receiveViewCloses('idle', 'idle')).toBe(false);
  });
  it('a join from Welcome goes to the source, or on to the look when a source is saved; from the sync step to the end', () => {
    expect(stepAfterJoin('welcome', false)).toBe('source');
    expect(stepAfterJoin('welcome', true)).toBe('look');
    expect(stepAfterJoin('sync', true)).toBe('done');
    expect(stepAfterJoin('sync', false)).toBe('done');
  });
});

describe('wrapFocus', () => {
  it('Tab past the last control comes back to the first, Shift+Tab before the first goes to the last', () => {
    expect(wrapFocus(3, 2, false)).toBe(0);
    expect(wrapFocus(3, 0, true)).toBe(2);
    expect(wrapFocus(3, 1, false)).toBe(null);
    expect(wrapFocus(3, -1, false)).toBe(0);
    expect(wrapFocus(0, -1, false)).toBe(null);
  });
});

import { heldFirstRun, keyUnsaved } from './firstRun';

describe('receive view (more)', () => {
  it('declining at the passphrase closes it; an apply that ends (restart or failure) does not', () => {
    expect(receiveViewCloses('passphrase', 'idle')).toBe(true);
    expect(receiveViewCloses('applying', 'idle')).toBe(false);
    expect(receiveViewCloses('applying', 'failed')).toBe(false);
  });
});

describe('heldFirstRun', () => {
  it('opens when settings and sources first say so', () => {
    expect(heldFirstRun(null, null)).toBe(null);
    expect(heldFirstRun(null, 'setup')).toBe('setup');
    expect(heldFirstRun(null, 'offer-sync')).toBe('offer-sync');
  });
  it('stays open after the first source is saved (live becomes null)', () => {
    expect(heldFirstRun('setup', null)).toBe('setup');
  });
  it('stays closed once closed, even with no sources', () => {
    expect(heldFirstRun('closed', 'setup')).toBe('closed');
  });
});

describe('keyUnsaved', () => {
  it('an empty key never holds Continue', () => {
    expect(keyUnsaved('', null)).toBe(false);
    expect(keyUnsaved('   ', false)).toBe(false);
  });
  it('a typed key holds Continue until it checks out, also while unchecked', () => {
    expect(keyUnsaved('abc', null)).toBe(true);
    expect(keyUnsaved('abc', false)).toBe(true);
    expect(keyUnsaved('abc', true)).toBe(false);
  });
});
