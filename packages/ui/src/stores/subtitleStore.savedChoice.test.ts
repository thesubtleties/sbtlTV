/**
 * Review (PR #146, finding 2): what a progress save records for the subtitle.
 * App.tsx's currentSubtitle() is not exported, so these tests target the
 * selector the fix is expected to move into the store: subtitleChoiceToSave()
 * returns the choice to save, or undefined to keep the stored one. They fail
 * until it exists; the first two describe the bug (a saved SubDL file that is
 * not loaded yet is saved over as "no file, delay 0, speed 1").
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as store from './subtitleStore';
import type { SubtitleTrack } from '../types/electron';

const { useSubtitleStore, initialSubtitleState } = store;
const choice = () => (store as unknown as { subtitleChoiceToSave: () => unknown }).subtitleChoiceToSave();

const spa: SubtitleTrack = { id: 1, lang: 'spa', title: null, codec: 'subrip', isCc: false, external: false, externalFile: null, hearingImpaired: false };
const eng: SubtitleTrack = { ...spa, id: 2, lang: 'eng' };
const info = { title: { tmdbId: 7, type: 'movie' as const }, language: 'en', languageIso: ['eng'], preferSdh: false };
const saved = { delay: 1.5, duration: 100, speed: 0.95904, subdlId: 'p/saved' };
let loadResult: unknown;
const ok = vi.fn(async () => ({ success: true }));

beforeEach(() => {
  loadResult = { trackId: 5, nId: 'p/saved', ai: false, timing: { speed: null, fps: null, cutMismatch: false } };
  (globalThis as unknown as { window: unknown }).window = {
    subtitles: { setTrack: ok, setVisible: ok, setDelay: ok },
    subdl: { load: vi.fn(async () => loadResult), setSpeed: ok },
  };
  useSubtitleStore.setState(initialSubtitleState());
});
const s = () => useSubtitleStore.getState();
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('review finding 2: a saved SubDL choice that is not showing is not saved over', () => {
  it('subtitles off at start: keep the stored choice', () => {
    s().bindLoad(3, 'vod', false, 'en-US', saved, info);
    s().receiveTracks({ generation: 3, tracks: [spa], duration: 100 }, false, 'en-US');
    expect(choice()).toBeUndefined();
  });

  it('the saved file could not be loaded (no downloads left): keep the stored choice', async () => {
    loadResult = { error: 'quota' };
    s().bindLoad(3, 'vod', true, 'en-US', saved, info);
    s().receiveTracks({ generation: 3, tracks: [spa], duration: 100 }, true, 'en-US');
    await flush();
    expect(s().selectedId).toBe(1);   // fell back to the file's track
    expect(choice()).toBeUndefined();
  });

  it('once the saved file shows, its choice is what is saved', async () => {
    s().bindLoad(3, 'vod', true, 'en-US', saved, info);
    s().receiveTracks({ generation: 3, tracks: [spa], duration: 100 }, true, 'en-US');
    await flush();
    expect(choice()).toEqual({ delay: 1.5, speed: 0.95904, subdlId: 'p/saved', ai: false });
  });

  it('no saved choice and a built-in track: delay 0, speed 1, no file', () => {
    s().bindLoad(3, 'vod', true, 'en-US', null, info);
    s().receiveTracks({ generation: 3, tracks: [eng], duration: 100 }, true, 'en-US');
    expect(choice()).toEqual({ delay: 0, speed: 1, subdlId: null, ai: false });
  });
});
