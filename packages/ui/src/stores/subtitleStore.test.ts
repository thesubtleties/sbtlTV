import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSubtitleStore, initialSubtitleState } from './subtitleStore';
import type { SubtitleTrack } from '../types/electron';

const cc: SubtitleTrack = { id: 1, lang: null, title: null, codec: 'eia_608', isCc: true, external: false, externalFile: null, hearingImpaired: false };
const eng: SubtitleTrack = { id: 1, lang: 'eng', title: null, codec: 'mov_text', isCc: false, external: false, externalFile: null, hearingImpaired: false };
const vodCc: SubtitleTrack = { id: 2, lang: null, title: null, codec: 'eia_608', isCc: true, external: false, externalFile: null, hearingImpaired: false };

const setTrack = vi.fn(async () => ({ success: true }));
const setVisible = vi.fn(async () => ({ success: true }));
const setDelay = vi.fn(async () => ({ success: true }));

beforeEach(() => {
  setTrack.mockClear(); setVisible.mockClear(); setDelay.mockClear();
  (globalThis as unknown as { window: unknown }).window = { subtitles: { setTrack, setVisible, setDelay, onTracks: () => () => {}, onCcState: () => () => {} } };
  useSubtitleStore.setState(initialSubtitleState());
});

const s = () => useSubtitleStore.getState();
const live = (generation: number, tracks: SubtitleTrack[], duration = 0) => ({ generation, tracks, duration });

describe('load binding', () => {
  it('updates for a load that is not bound yet wait for it', () => {
    s().receiveTracks(live(5, [cc]), false, 'en-US');   // main pushes before mpv-load resolves
    expect(s().tracks).toEqual([]);
    s().bindLoad(5, 'live', false, 'en-US', null);
    expect(s().tracks).toEqual([cc]);
  });

  it('updates for an older load are dropped', () => {
    s().bindLoad(5, 'live', false, 'en-US', null);
    s().receiveTracks(live(4, [cc]), false, 'en-US');
    expect(s().tracks).toEqual([]);
  });

  it('an announcement for an older load does not take over from a newer one', () => {
    s().bindLoad(6, 'vod', true, 'en-US', null);
    s().receiveTracks(live(6, [eng]), true, 'en-US');
    s().rebindLoad(5, true, 'en-US');
    s().bindLoad(5, 'live', true, 'en-US', null);
    expect(s().generation).toBe(6);
    expect(s().kind).toBe('vod');
    expect(s().tracks).toEqual([eng]);
  });

  it('every control call carries the bound generation', () => {
    s().bindLoad(7, 'live', true, 'en-US', null);
    s().receiveTracks(live(7, [cc]), true, 'en-US');
    expect(setTrack).toHaveBeenLastCalledWith(7, 1, true);
    s().nudgeDelay(0.1);
    expect(setDelay).toHaveBeenLastCalledWith(7, 0.1);
  });
});

describe('live captions (TV-style)', () => {
  it('the CC track is selected at channel start even when captions are off', () => {
    s().bindLoad(1, 'live', false, 'en-US', null);
    s().receiveTracks(live(1, [cc]), false, 'en-US');
    expect(setTrack).toHaveBeenLastCalledWith(1, 1, false);
    expect(s().visible).toBe(false);
  });

  it('toggling only shows or hides, and the session remembers it', () => {
    s().bindLoad(1, 'live', false, 'en-US', null);
    s().receiveTracks(live(1, [cc]), false, 'en-US');
    setTrack.mockClear();
    s().toggle('en-US');
    expect(setVisible).toHaveBeenLastCalledWith(1, true);
    expect(setTrack).not.toHaveBeenCalled();
    s().bindLoad(2, 'live', false, 'en-US', null);
    s().receiveTracks(live(2, [cc]), false, 'en-US');
    expect(setTrack).toHaveBeenLastCalledWith(2, 1, true);   // next channel starts shown
  });

  it('unreadable captions cannot be turned on', () => {
    s().bindLoad(1, 'live', true, 'en-US', null);
    s().receiveTracks(live(1, [cc]), true, 'en-US');
    s().receiveCcState({ generation: 1, state: 'unreadable', language: null });
    expect(s().ccState).toBe('unreadable');
    setVisible.mockClear();
    s().toggle('en-US');
    expect(setVisible).not.toHaveBeenCalled();
  });

  it('a cc state for another load is ignored', () => {
    s().bindLoad(2, 'live', true, 'en-US', null);
    s().receiveCcState({ generation: 1, state: 'unreadable', language: null });
    expect(s().ccState).toBeNull();
  });
});

describe('movies and episodes', () => {
  it('only the file\'s own subtitle tracks are offered', () => {
    s().bindLoad(1, 'vod', true, 'en-US', null);
    s().receiveTracks({ generation: 1, tracks: [eng, vodCc], duration: 0 }, true, 'en-US');
    expect(s().tracks).toEqual([eng]);
    expect(setTrack).toHaveBeenLastCalledWith(1, 1, true);
  });

  it('a file with only embedded CC has nothing to offer', () => {
    s().bindLoad(1, 'vod', true, 'en-US', null);
    s().receiveTracks({ generation: 1, tracks: [vodCc], duration: 0 }, true, 'en-US');
    expect(s().tracks).toEqual([]);
    expect(setTrack).not.toHaveBeenCalled();
  });

  it('live and vod session choices are independent', () => {
    s().bindLoad(1, 'live', false, 'en-US', null);
    s().receiveTracks(live(1, [cc]), false, 'en-US');
    s().toggle('en-US');                                   // CC on for live
    s().bindLoad(2, 'vod', false, 'en-US', null);
    s().receiveTracks({ generation: 2, tracks: [eng], duration: 0 }, false, 'en-US');
    expect(s().selectedId).toBeNull();
  });
});

describe('saved delay', () => {
  it('is restored once the file\'s duration matches', () => {
    s().bindLoad(1, 'vod', false, 'en-US', { delay: 0.4, duration: 7200 });
    expect(s().delayResolved).toBe(false);
    s().receiveTracks({ generation: 1, tracks: [eng], duration: 0 }, false, 'en-US');
    expect(s().delayResolved).toBe(false);                // duration not known yet
    s().receiveTracks({ generation: 1, tracks: [eng], duration: 7202 }, false, 'en-US');
    expect(s().delay).toBe(0.4);
    expect(s().delayResolved).toBe(true);
    expect(setDelay).toHaveBeenLastCalledWith(1, 0.4);
  });

  it('a different file under the same id starts at 0', () => {
    s().bindLoad(1, 'vod', false, 'en-US', { delay: 0.4, duration: 7200 });
    s().receiveTracks({ generation: 1, tracks: [eng], duration: 7300 }, false, 'en-US');
    expect(s().delay).toBe(0);
    expect(s().delayResolved).toBe(true);
  });

  it('nothing saved: resolved from the start', () => {
    s().bindLoad(1, 'vod', false, 'en-US', null);
    expect(s().delayResolved).toBe(true);
  });

  it('a user change is recorded with its load; a restore is not', () => {
    s().bindLoad(3, 'vod', false, 'en-US', { delay: 0.4, duration: 100 });
    s().receiveTracks({ generation: 3, tracks: [eng], duration: 100 }, false, 'en-US');
    expect(s().userDelayEdit).toBeNull();
    s().nudgeDelay(0.1);
    expect(s().userDelayEdit).toEqual({ seq: 1, generation: 3, delay: 0.5 });
    expect(s().delayResolved).toBe(true);
  });

  it('steps in tenths and resets per load', () => {
    s().bindLoad(1, 'vod', true, 'en-US', null);
    s().nudgeDelay(0.1); s().nudgeDelay(0.1);
    expect(s().delay).toBe(0.2);
    s().bindLoad(2, 'vod', true, 'en-US', null);
    expect(s().delay).toBe(0);
  });
});

describe('automatic reload of the same stream', () => {
  it('keeps the session choice and the delay on the reloaded load', () => {
    s().bindLoad(1, 'vod', true, 'en-US', null);
    s().receiveTracks({ generation: 1, tracks: [eng], duration: 100 }, true, 'en-US');
    s().nudgeDelay(0.3);
    setDelay.mockClear(); setTrack.mockClear();
    s().rebindLoad(2, true, 'en-US');
    expect(s().generation).toBe(2);
    expect(s().kind).toBe('vod');
    expect(s().delay).toBe(0.3);
    expect(setDelay).toHaveBeenLastCalledWith(2, 0.3);   // main reset sub-delay with the reload
    s().receiveTracks({ generation: 2, tracks: [eng], duration: 100 }, true, 'en-US');
    expect(setTrack).toHaveBeenLastCalledWith(2, 1, true);
  });

  it('live captions come back shown if they were shown', () => {
    s().bindLoad(1, 'live', false, 'en-US', null);
    s().receiveTracks({ generation: 1, tracks: [cc], duration: 0 }, false, 'en-US');
    s().toggle('en-US');                                   // shown
    s().receiveTracks({ generation: 2, tracks: [cc], duration: 0 }, false, 'en-US');  // arrives before the rebind
    s().rebindLoad(2, false, 'en-US');
    expect(setTrack).toHaveBeenLastCalledWith(2, 1, true);
  });
});

describe('captions only in another language', () => {
  it('are kept with their language and can be shown and hidden', () => {
    s().bindLoad(1, 'live', false, 'en-US', null);
    s().receiveTracks({ generation: 1, tracks: [cc], duration: 0 }, false, 'en-US');
    s().receiveCcState({ generation: 1, state: 'other-language', language: 'es' });
    expect(s().ccState).toBe('other-language');
    expect(s().ccLanguage).toBe('es');
    s().toggle('en-US');
    expect(setVisible).toHaveBeenLastCalledWith(1, true);
  });
});

describe('changing the subtitle language while a movie plays', () => {
  const spa: SubtitleTrack = { id: 2, lang: 'spa', title: null, codec: 'subrip', isCc: false, external: false, externalFile: null, hearingImpaired: false };

  it('switches to the track in the new language', () => {
    s().bindLoad(1, 'vod', true, 'en-US', null);
    s().receiveTracks({ generation: 1, tracks: [eng, spa], duration: 100 }, true, 'en-US');
    expect(s().selectedId).toBe(1);
    s().repickVodTrack('es');
    expect(s().selectedId).toBe(2);
    expect(setTrack).toHaveBeenLastCalledWith(1, 2, true);
  });

  it('keeps the current track when none is in the new language', () => {
    s().bindLoad(1, 'vod', true, 'es-MX', null);
    s().receiveTracks({ generation: 1, tracks: [eng, spa], duration: 100 }, true, 'es-MX');
    expect(s().selectedId).toBe(2);
    setTrack.mockClear();
    s().repickVodTrack('fr');
    expect(s().selectedId).toBe(2);
    expect(setTrack).not.toHaveBeenCalled();
  });

  it('leaves subtitles that are off, off', () => {
    s().bindLoad(1, 'vod', false, 'en-US', null);
    s().receiveTracks({ generation: 1, tracks: [eng, spa], duration: 100 }, false, 'en-US');
    setTrack.mockClear();
    s().repickVodTrack('es');
    expect(s().selectedId).toBeNull();
    expect(setTrack).not.toHaveBeenCalled();
  });
});
