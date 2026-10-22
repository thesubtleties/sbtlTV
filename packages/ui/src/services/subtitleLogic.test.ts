import { describe, it, expect } from 'vitest';
import { pickSubtitleTrack, stepDelay, formatDelay, trackLabel } from './subtitleLogic';
import { decideVodSubtitle, heardAt, solveSync, subdlStatusText, SYNC_REACTION_S, syncCueKey, stepSyncFocus } from './subtitleLogic';
import type { SubtitleTrack } from '../types/electron';

const cc: SubtitleTrack = { id: 1, lang: null, title: null, codec: 'eia_608', isCc: true, external: false, externalFile: null, hearingImpaired: false };
const eng: SubtitleTrack = { id: 1, lang: 'eng', title: null, codec: 'mov_text', isCc: false, external: false, externalFile: null, hearingImpaired: false };
const spa: SubtitleTrack = { id: 2, lang: 'spa', title: 'Spanish', codec: 'subrip', isCc: false, external: false, externalFile: null, hearingImpaired: false };
const und: SubtitleTrack = { id: 3, lang: 'und', title: null, codec: 'mov_text', isCc: false, external: false, externalFile: null, hearingImpaired: false };

describe('pickSubtitleTrack', () => {
  it('live picks the CC track', () => {
    expect(pickSubtitleTrack([cc], 'live', 'en-US')).toBe(1);
  });
  it('vod picks the system language', () => {
    expect(pickSubtitleTrack([spa, eng], 'vod', 'en-US')).toBe(1);
    expect(pickSubtitleTrack([eng, spa], 'vod', 'es-MX')).toBe(2);
  });
  it('vod falls back to the first track', () => {
    expect(pickSubtitleTrack([und, spa], 'vod', 'de-DE')).toBe(3);
  });
  it('no tracks, no pick', () => {
    expect(pickSubtitleTrack([], 'vod', 'en-US')).toBeNull();
    expect(pickSubtitleTrack([], 'live', 'en-US')).toBeNull();
  });
});

describe('delay', () => {
  it('steps in tenths without float drift', () => {
    expect(stepDelay(0, 0.1)).toBe(0.1);
    expect(stepDelay(0.1, 0.1)).toBe(0.2);
    expect(stepDelay(0.3, -0.1)).toBe(0.2);
    expect(stepDelay(0.1, -0.1)).toBe(0);
  });
  it('clamps to 60 seconds', () => {
    expect(stepDelay(60, 0.1)).toBe(60);
    expect(stepDelay(-60, -0.1)).toBe(-60);
  });
  it('formats with a sign', () => {
    expect(formatDelay(0)).toBe('0.0s');
    expect(formatDelay(0.3)).toBe('+0.3s');
    expect(formatDelay(-1.2)).toBe('-1.2s');
  });
});

describe('trackLabel', () => {
  it('names tracks for the menu', () => {
    expect(trackLabel(cc)).toBe('Closed captions');
    expect(trackLabel(eng)).toBe('English');
    expect(trackLabel(spa)).toBe('Spanish');
    expect(trackLabel(und)).toBe('Subtitles 3');
  });
});

describe('decideVodSubtitle', () => {
  const t = (id: number, lang: string | null, o: Partial<SubtitleTrack> = {}): SubtitleTrack => ({ id, lang, title: null, codec: 'subrip', isCc: false, external: false, externalFile: null, hearingImpaired: false, ...o });
  const base = { languageIso: ['eng'], preferSdh: false, subdl: true, saved: null };

  it('saved SubDL choice wins', () => {
    expect(decideVodSubtitle([t(1, 'eng')], { ...base, saved: { subdlId: 'p/f', ai: false, delay: 0, speed: 1, duration: 100 } })).toEqual({ kind: 'subdl', nId: 'p/f' });
  });
  it('built-in track in the language is kept', () => {
    expect(decideVodSubtitle([t(1, 'spa'), t(2, 'eng')], base)).toEqual({ kind: 'track', id: 2 });
  });
  it('none in the language -> SubDL auto', () => {
    expect(decideVodSubtitle([t(1, 'spa')], base)).toEqual({ kind: 'subdl', nId: 'auto' });
    expect(decideVodSubtitle([], base)).toEqual({ kind: 'subdl', nId: 'auto' });
  });
  it('SDH: a flagged built-in track, else SubDL', () => {
    expect(decideVodSubtitle([t(1, 'eng'), t(2, 'eng', { hearingImpaired: true })], { ...base, preferSdh: true })).toEqual({ kind: 'track', id: 2 });
    expect(decideVodSubtitle([t(1, 'eng')], { ...base, preferSdh: true })).toEqual({ kind: 'subdl', nId: 'auto' });
  });
  it('a downloaded track already loaded is not downloaded again', () => {
    expect(decideVodSubtitle([t(1, 'spa'), t(3, null, { external: true })], base)).toEqual({ kind: 'track', id: 3 });
  });
  it('no key or no TMDB match: exactly as before (language, else first, else off)', () => {
    expect(decideVodSubtitle([t(1, 'spa'), t(2, 'eng')], { ...base, subdl: false })).toEqual({ kind: 'track', id: 2 });
    expect(decideVodSubtitle([t(1, 'spa')], { ...base, subdl: false })).toEqual({ kind: 'track', id: 1 });
    expect(decideVodSubtitle([], { ...base, subdl: false })).toEqual({ kind: 'off' });
  });
});

describe('solveSync (same maths as main)', () => {
  it('one point sets the delay at the current speed', () => {
    expect(solveSync([{ cueStart: 100, at: 103.5 }], 1)).toEqual({ delay: 3.5, speed: 1 });
  });
  it('two points far apart solve speed and delay', () => {
    const r = solveSync([{ cueStart: 100, at: 100 * 0.95904 + 2 }, { cueStart: 3000, at: 3000 * 0.95904 + 2 }], 1);
    expect(r.speed).toBeCloseTo(0.95904, 6);
    expect(r.delay).toBeCloseTo(2, 6);
  });
  it('two points too close, or an absurd speed, only set the delay', () => {
    expect(solveSync([{ cueStart: 100, at: 101 }, { cueStart: 130, at: 140 }], 1)).toEqual({ delay: 10, speed: 1 });
    expect(solveSync([{ cueStart: 100, at: 100 }, { cueStart: 1000, at: 2000 }], 1)).toEqual({ delay: 1000, speed: 1 });
  });
});

describe('subdlStatusText', () => {
  it('says what happened in plain words', () => {
    expect(subdlStatusText('quota')).toBe('No SubDL downloads left today');
    expect(subdlStatusText('not-found')).toBe('No subtitles found on SubDL');
    expect(subdlStatusText('auth')).toBe('SubDL key not accepted');
    expect(subdlStatusText('cut')).toBe('Timing may be off · Find another or Sync');
    expect(subdlStatusText({ fps: { from: 25, to: 23.976 } })).toBe('Speed fixed (25 → 23.976 fps)');
    expect(subdlStatusText(null)).toBe(null);
  });
});

describe('trackLabel for downloaded tracks', () => {
  it('names a SubDL track by its language, not the cache file name', () => {
    const t: SubtitleTrack = { id: 5, lang: null, title: 'abc__def.srt', codec: 'subrip', isCc: false, external: true, externalFile: '/x/abc__def.srt', hearingImpaired: false };
    expect(trackLabel(t, 'English')).toBe('English');
    expect(trackLabel(t)).toBe('Downloaded subtitles');
  });
});

describe('heardAt', () => {
  it('a tap lands a moment after the line started: the reaction time is taken off', () => {
    expect(heardAt(100)).toBeCloseTo(100 - SYNC_REACTION_S, 6);
    expect(SYNC_REACTION_S).toBeGreaterThan(0.1);
    expect(SYNC_REACTION_S).toBeLessThan(0.5);
  });
  it('one tap on a line heard on time leaves the delay near 0', () => {
    const r = solveSync([{ cueStart: 100, at: heardAt(100 + SYNC_REACTION_S) }], 1);
    expect(r.delay).toBeCloseTo(0, 6);
  });
});

describe('review: decideVodSubtitle edges', () => {
  const t = (id: number, lang: string | null, o: Partial<SubtitleTrack> = {}): SubtitleTrack => ({ id, lang, title: null, codec: 'subrip', isCc: false, external: false, externalFile: null, hearingImpaired: false, ...o });
  const base = { languageIso: ['eng'], preferSdh: false, subdl: true, saved: null };

  it('track languages match case-insensitively', () => {
    expect(decideVodSubtitle([t(1, 'ENG')], base)).toEqual({ kind: 'track', id: 1 });
  });
  it('a downloaded track wins over SDH preference (no second download)', () => {
    expect(decideVodSubtitle([t(1, 'eng'), t(4, null, { external: true })], { ...base, preferSdh: true })).toEqual({ kind: 'track', id: 4 });
  });
  it('a saved choice without a SubDL file falls through to the normal rule', () => {
    expect(decideVodSubtitle([t(1, 'eng')], { ...base, saved: { subdlId: null, ai: false, delay: 1, speed: 1, duration: 100 } })).toEqual({ kind: 'track', id: 1 });
  });
  it('an external track never counts as the built-in track in the language', () => {
    expect(decideVodSubtitle([t(3, 'eng', { external: true })], { ...base, subdl: false })).toEqual({ kind: 'track', id: 3 });
  });
});

describe('solveSync speed snapping (renderer copy)', () => {
  it('snaps to a frame-rate ratio, else changes only the delay', () => {
    const fps = 23.976 / 25;
    expect(solveSync([{ cueStart: 100, at: 100 * fps + 2 }, { cueStart: 3000, at: 3000 * fps * 1.0002 + 2 }], 1).speed).toBeCloseTo(fps, 9);
    expect(solveSync([{ cueStart: 100, at: 100 }, { cueStart: 700, at: 730 }], 1)).toEqual({ speed: 1, delay: 30 });
  });
  it('delay only when asked (the subtitle may be for another cut)', () => {
    const fps = 23.976 / 25;
    expect(solveSync([{ cueStart: 100, at: 100 * fps }, { cueStart: 3000, at: 3000 * fps }], 1, { speed: false }).speed).toBe(1);
  });
});

describe('Sync list focus (by line, not by row number)', () => {
  const a = { start: 10, text: 'One' }, b = { start: 12, text: 'Two' }, c = { start: 15, text: 'Three' }, d = { start: 18, text: 'Four' };
  it('a line keeps its key when the list slides', () => {
    expect(syncCueKey(b)).toBe(syncCueKey({ ...b }));
    expect(syncCueKey(b)).not.toBe(syncCueKey(c));
  });
  it('lines that start together are still told apart', () => {
    expect(syncCueKey({ start: 12, text: 'Two' })).not.toBe(syncCueKey({ start: 12, text: 'Other' }));
  });
  it('Up/Down move from the focused line even after the list slid under it', () => {
    // b was row 1; a dropped off the top, so b is now row 0
    expect(stepSyncFocus([b, c, d], syncCueKey(b), 1)).toBe(syncCueKey(c));
    expect(stepSyncFocus([b, c, d], syncCueKey(c), -1)).toBe(syncCueKey(b));
  });
  it('stops at the ends; a line no longer listed starts from the top; no lines, no focus', () => {
    expect(stepSyncFocus([a, b], syncCueKey(b), 1)).toBe(syncCueKey(b));
    expect(stepSyncFocus([a, b], syncCueKey(a), -1)).toBe(syncCueKey(a));
    expect(stepSyncFocus([b, c], syncCueKey(a), 1)).toBe(syncCueKey(b));
    expect(stepSyncFocus([], syncCueKey(a), 1)).toBeNull();
  });
});
