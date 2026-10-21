import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSubtitleStore, initialSubtitleState, type SubdlLoadInfo } from './subtitleStore';
import type { SubtitleTrack } from '../types/electron';

const track = (id: number, lang: string | null, o: Partial<SubtitleTrack> = {}): SubtitleTrack => ({ id, lang, title: null, codec: 'subrip', isCc: false, external: false, externalFile: null, hearingImpaired: false, ...o });
const spa = track(1, 'spa');
const eng = track(2, 'eng');
const downloaded = track(5, null, { external: true, externalFile: '/u/subtitles/movie_7/p__f.srt' });

const setTrack = vi.fn(async () => ({ success: true }));
const setVisible = vi.fn(async () => ({ success: true }));
const setDelay = vi.fn(async () => ({ success: true }));
const setSpeed = vi.fn(async () => ({ success: true }));
let loadResult: Record<string, unknown> = { trackId: 5, nId: 'p/f', ai: false, timing: { speed: null, fps: null, cutMismatch: false } };
let resolveLoad: (() => void) | null = null;
const load = vi.fn((..._args: unknown[]) => new Promise((resolve) => { resolveLoad = () => resolve(loadResult); }));

const info: SubdlLoadInfo = { title: { tmdbId: 7, type: 'movie' }, language: 'en', languageIso: ['eng'], preferSdh: false };

beforeEach(() => {
  for (const f of [setTrack, setVisible, setDelay, setSpeed, load]) f.mockClear();
  loadResult = { trackId: 5, nId: 'p/f', ai: false, timing: { speed: null, fps: null, cutMismatch: false } };
  resolveLoad = null;
  (globalThis as unknown as { window: unknown }).window = {
    subtitles: { setTrack, setVisible, setDelay, onTracks: () => () => {}, onCcState: () => () => {} },
    subdl: { load, setSpeed },
  };
  useSubtitleStore.setState(initialSubtitleState());
});

const s = () => useSubtitleStore.getState();
const update = (generation: number, tracks: SubtitleTrack[], duration = 0) => ({ generation, tracks, duration });
const settle = async () => { resolveLoad?.(); await new Promise((r) => setTimeout(r, 0)); };

describe('SubDL when the file has no subtitle in the language', () => {
  it('waits for the real track list: the empty one announced at load start is not a decision', async () => {
    s().bindLoad(3, 'vod', true, 'en-US', null, info);
    s().receiveTracks(update(3, [], 0), true, 'en-US');   // reset at load start
    expect(load).not.toHaveBeenCalled();
    s().receiveTracks(update(3, [eng], 120), true, 'en-US');
    expect(load).not.toHaveBeenCalled();
    expect(s().selectedId).toBe(2);
  });

  it('a real list without the language (duration known) does go to SubDL', () => {
    s().bindLoad(3, 'vod', true, 'en-US', null, info);
    s().receiveTracks(update(3, [], 0), true, 'en-US');
    s().receiveTracks(update(3, [spa], 120), true, 'en-US');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('loads the best match once, then selects and tags it', async () => {
    s().bindLoad(3, 'vod', true, 'en-US', null, info);
    s().receiveTracks(update(3, [spa], 120), true, 'en-US');
    s().receiveTracks(update(3, [spa], 120), true, 'en-US');
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(3, info.title, 'auto', 'en', 0);
    s().receiveTracks(update(3, [spa, downloaded], 120), true, 'en-US');  // main pushes the new list before load returns
    await settle();
    expect(s().selectedId).toBe(5);
    expect(s().downloaded[5]).toEqual({ nId: 'p/f', ai: false, language: 'en' });
    expect(setTrack).toHaveBeenLastCalledWith(3, 5, true);
  });

  it('a built-in track in the language is used, no SubDL request', () => {
    s().bindLoad(3, 'vod', true, 'en-US', null, info);
    s().receiveTracks(update(3, [spa, eng], 120), true, 'en-US');
    expect(load).not.toHaveBeenCalled();
    expect(s().selectedId).toBe(2);
  });

  it('a result for an earlier load is dropped', async () => {
    s().bindLoad(3, 'vod', true, 'en-US', null, info);
    s().receiveTracks(update(3, [spa], 120), true, 'en-US');
    s().bindLoad(4, 'vod', true, 'en-US', null, null);
    await settle();
    expect(setTrack).not.toHaveBeenCalledWith(3, 5, true);
    expect(s().selectedId).toBe(null);
  });

  it('subtitles off by default: nothing loads until CC is pressed, even with no tracks', async () => {
    s().bindLoad(3, 'vod', false, 'en-US', null, info);
    s().receiveTracks(update(3, [], 120), false, 'en-US');
    expect(load).not.toHaveBeenCalled();
    s().toggle('en-US');
    expect(load).toHaveBeenCalledTimes(1);
    await settle();
    expect(s().selectedId).toBe(5);
  });

  it('no downloads left: says so and falls back to the file\'s track', async () => {
    loadResult = { error: 'quota' };
    s().bindLoad(3, 'vod', true, 'en-US', null, info);
    s().receiveTracks(update(3, [spa], 120), true, 'en-US');
    await settle();
    expect(s().subdlStatus).toBe('quota');
    expect(s().selectedId).toBe(1);
  });

  it('a saved SubDL choice loads that file and restores its delay and speed', async () => {
    loadResult = { trackId: 5, nId: 'p/saved', ai: true, timing: { speed: null, fps: null, cutMismatch: false } };
    s().bindLoad(3, 'vod', true, 'en-US', { delay: 1.5, duration: 100, speed: 0.95904, subdlId: 'p/saved', ai: true }, info);
    s().receiveTracks(update(3, [spa], 100), true, 'en-US');
    expect(load).toHaveBeenCalledWith(3, info.title, 'p/saved', 'en', 0);
    await settle();
    expect(setDelay).toHaveBeenLastCalledWith(3, 1.5);
    expect(setSpeed).toHaveBeenLastCalledWith(3, 0.95904);
    expect(s().downloaded[5]).toEqual({ nId: 'p/saved', ai: true, language: 'en' });
  });

  it('a frame-rate mismatch is fixed and reported', async () => {
    loadResult = { trackId: 5, nId: 'p/f', ai: false, timing: { speed: 23.976 / 25, fps: { from: 25, to: 23.976 }, cutMismatch: false } };
    s().bindLoad(3, 'vod', true, 'en-US', null, info);
    s().receiveTracks(update(3, [spa], 120), true, 'en-US');
    await settle();
    expect(setSpeed).toHaveBeenLastCalledWith(3, 23.976 / 25);
    expect(s().subdlStatus).toEqual({ fps: { from: 25, to: 23.976 } });
  });

  it('a picked file is a user choice: recorded for saving', async () => {
    s().bindLoad(3, 'vod', true, 'en-US', null, info);
    s().receiveTracks(update(3, [eng], 120), true, 'en-US');
    const picked = s().loadSubdl('p/f', true, 'fr');
    await settle();
    await picked;
    expect(s().userSubtitleEdit).toMatchObject({ generation: 3, subdlId: 'p/f', speed: 1, delay: 0 });
    expect(s().downloaded[5]).toEqual({ nId: 'p/f', ai: false, language: 'fr' });
  });
});
