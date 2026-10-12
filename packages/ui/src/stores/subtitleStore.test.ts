import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSubtitleStore } from './subtitleStore';
import type { SubtitleTrack } from '../types/electron';

const cc: SubtitleTrack = { id: 1, lang: null, title: null, codec: 'eia_608', isCc: true };
const eng: SubtitleTrack = { id: 1, lang: 'eng', title: null, codec: 'mov_text', isCc: false };

const setTrack = vi.fn(async () => ({ success: true }));
const setDelay = vi.fn(async () => ({ success: true }));

beforeEach(() => {
  setTrack.mockClear(); setDelay.mockClear();
  (globalThis as unknown as { window: unknown }).window = { subtitles: { setTrack, setDelay, onTracks: () => () => {} } };
  useSubtitleStore.setState({ kind: null, generation: -1, tracks: [], selectedId: null, delay: 0, sessionOn: { live: null, vod: null } });
});

const s = () => useSubtitleStore.getState();

describe('subtitleStore', () => {
  it('a new stream follows the default when the session has no choice', () => {
    s().startStream('live', 1, [cc], true, 'en-US');
    expect(s().selectedId).toBe(1);
    expect(setTrack).toHaveBeenLastCalledWith(1);
    s().startStream('live', 2, [cc], false, 'en-US');
    expect(s().selectedId).toBeNull();
  });

  it('the session choice beats the default until restart', () => {
    s().startStream('live', 1, [cc], false, 'en-US');
    s().toggle('en-US');                        // user turns CC on
    expect(s().selectedId).toBe(1);
    s().startStream('live', 2, [cc], false, 'en-US');
    expect(s().selectedId).toBe(1);             // still on for the next channel
  });

  it('live and vod session choices are independent', () => {
    s().startStream('live', 1, [cc], false, 'en-US');
    s().toggle('en-US');                        // CC on for live
    s().startStream('vod', 2, [eng], false, 'en-US');
    expect(s().selectedId).toBeNull();          // vod still follows its own default
  });

  it('a later track update turns on a track that was wanted but missing', () => {
    s().startStream('live', 1, [], true, 'en-US');
    expect(s().selectedId).toBeNull();
    s().updateTracks([cc], true, 'en-US');
    expect(s().selectedId).toBe(1);
  });

  it('toggle does nothing without tracks', () => {
    s().startStream('vod', 1, [], false, 'en-US');
    s().toggle('en-US');
    expect(s().selectedId).toBeNull();
    expect(s().sessionOn.vod).toBeNull();
  });

  it('a new stream starts at delay 0; nudges step and send', () => {
    s().startStream('vod', 1, [eng], true, 'en-US');
    s().nudgeDelay(0.1); s().nudgeDelay(0.1);
    expect(s().delay).toBe(0.2);
    expect(setDelay).toHaveBeenLastCalledWith(0.2);
    s().startStream('vod', 2, [eng], true, 'en-US');
    expect(s().delay).toBe(0);
  });

  it('selecting Off records the session choice as off', () => {
    s().startStream('vod', 1, [eng], true, 'en-US');
    s().selectTrack(null);
    expect(s().sessionOn.vod).toBe(false);
    s().startStream('vod', 2, [eng], true, 'en-US');
    expect(s().selectedId).toBeNull();
  });
});
