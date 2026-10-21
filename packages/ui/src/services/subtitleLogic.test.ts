import { describe, it, expect } from 'vitest';
import { pickSubtitleTrack, stepDelay, formatDelay, trackLabel } from './subtitleLogic';
import { decideVodSubtitle } from './subtitleLogic';
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
