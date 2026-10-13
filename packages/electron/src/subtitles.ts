// Subtitles and live captions: the pure parts (settings, mpv track list,
// style options, when to read the track list). No electron imports, so it
// runs under node:test. mpv draws the subtitles in both players; main only
// configures it and tells the renderer which tracks exist.

import path from 'node:path';

export type SubtitleSize = 'small' | 'medium' | 'large';
export type SubtitleStyle = 'outline' | 'box' | 'shadow';
/** Captions and subtitles language; auto = the system language */
export type CaptionLanguageSetting = 'auto' | 'en' | 'es' | 'fr';
export type CaptionLanguage = 'en' | 'es' | 'fr';
export interface SubtitleSettings {
  liveDefault: boolean;  // live captions on when a channel starts
  vodDefault: boolean;   // movie & series subtitles on when one starts
  size: SubtitleSize;
  style: SubtitleStyle;
  language: CaptionLanguageSetting;
}

const SIZES: readonly SubtitleSize[] = ['small', 'medium', 'large'];
const STYLES: readonly SubtitleStyle[] = ['outline', 'box', 'shadow'];
const LANGUAGES: readonly CaptionLanguageSetting[] = ['auto', 'en', 'es', 'fr'];

export function normalizeSubtitleSettings(value: unknown): SubtitleSettings {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    liveDefault: v.liveDefault === true,
    vodDefault: v.vodDefault === true,
    size: SIZES.find(s => s === v.size) ?? 'medium',
    style: STYLES.find(s => s === v.style) ?? 'outline',
    language: LANGUAGES.find(l => l === v.language) ?? 'auto',
  };
}

/**
 * The language live captions should be in: the setting, or for auto the system
 * language when it is one the caption check can tell apart (US/Canadian
 * broadcast captions are English, Spanish or French). null: no preference.
 */
export function preferredCaptionLanguage(setting: CaptionLanguageSetting, systemLocale: string): CaptionLanguage | null {
  if (setting !== 'auto') return setting;
  const primary = systemLocale.toLowerCase().split(/[-_]/)[0];
  return primary === 'en' || primary === 'es' || primary === 'fr' ? primary : null;
}

export interface SubtitleTrack {
  id: number;
  lang: string | null;
  title: string | null;
  codec: string;
  isCc: boolean;  // EIA-608 closed captions carried in the video
}

/** mpv's track-list (JSON string from libmpv, array from the IPC socket) -> subtitle tracks. */
export function parseSubtitleTracks(value: unknown): SubtitleTrack[] {
  let list: unknown = value;
  if (typeof value === 'string') {
    try { list = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(list)) return [];
  const tracks: SubtitleTrack[] = [];
  for (const t of list) {
    if (!t || typeof t !== 'object') continue;
    const r = t as Record<string, unknown>;
    if (r.type !== 'sub' || typeof r.id !== 'number') continue;
    const codec = typeof r.codec === 'string' ? r.codec : '';
    tracks.push({
      id: r.id,
      lang: typeof r.lang === 'string' ? r.lang : null,
      title: typeof r.title === 'string' ? r.title : null,
      codec,
      isCc: codec === 'eia_608',
    });
  }
  return tracks;
}

/** Always set in both players. sid=no: nothing shows until the app picks a track. */
export const SUBTITLE_BASE_OPTIONS: Array<[string, string]> = [
  ['sub-create-cc-track', 'yes'],  // a selectable CC track for live TV before any caption arrives
  ['sub-auto', 'no'],              // no sidecar subtitle requests to the provider
  ['sid', 'no'],
];

/** mpv keeps the selected track, sub-delay and visibility across loadfile; reset them before each load. */
export function loadResetOptions(): Array<[string, string]> {
  return [['sid', 'no'], ['sub-delay', '0'], ['sub-visibility', 'yes']];
}

const FONT_SIZE: Record<SubtitleSize, string> = { small: '38', medium: '46', large: '56' };
const FONT: Record<'fira' | 'mono' | 'system', string> = { fira: 'Fira Sans', mono: 'JetBrains Mono', system: 'sans-serif' };

/** mpv options for the chosen look. Applies to text subtitles (EIA-608, mov_text, SRT). */
export function subtitleStyleOptions(settings: SubtitleSettings, typeface: 'fira' | 'mono' | 'system'): Array<[string, string]> {
  const common: Array<[string, string]> = [
    ['sub-font', FONT[typeface]],
    ['sub-font-size', FONT_SIZE[settings.size]],
    ['sub-color', '#FFFFFFFF'],
    ['sub-pos', '92'],  // a little above the bottom so the bar does not cover the last line
  ];
  switch (settings.style) {
    case 'box':
      // libass draws the opaque box in the border color; border size is the padding
      return [...common, ['sub-border-style', 'opaque-box'], ['sub-border-color', '#C0101010'], ['sub-border-size', '3'], ['sub-shadow-offset', '0']];
    case 'shadow':
      return [...common, ['sub-border-style', 'outline-and-shadow'], ['sub-border-color', '#FF000000'], ['sub-border-size', '1'], ['sub-shadow-offset', '2'], ['sub-back-color', '#A0000000']];
    default:
      return [...common, ['sub-border-style', 'outline-and-shadow'], ['sub-border-color', '#FF000000'], ['sub-border-size', '2.5'], ['sub-shadow-offset', '0'], ['sub-back-color', '#00000000']];
  }
}

/**
 * When the in-window player should read track-list for the current load.
 * The read is a synchronous call into mpv on main, so it happens only after
 * the video is up, and repeats (at most maxReads, intervalMs apart) only
 * while no subtitle track has shown up yet: the live CC track is created
 * with the video decoder, which can come a moment after the first frame size.
 */
export class TrackReadSchedule {
  private reads = 0;
  private lastRead = -Infinity;
  private done = false;

  constructor(private readonly maxReads = 10, private readonly intervalMs = 1000) {}

  reset(): void {
    this.reads = 0;
    this.lastRead = -Infinity;
    this.done = false;
  }

  shouldRead(now: number, videoUp: boolean): boolean {
    if (this.done || !videoUp || this.reads >= this.maxReads) return false;
    return now - this.lastRead >= this.intervalMs;
  }

  record(now: number, tracks: SubtitleTrack[]): void {
    this.reads++;
    this.lastRead = now;
    if (tracks.length > 0) this.done = true;
  }
}

/** Folder of bundled TTFs for mpv's sub-fonts-dir (extraResources when packaged). */
export function subtitleFontsDir(opts: { isPackaged: boolean; resourcesPath: string; dirname: string }): string {
  return opts.isPackaged
    ? path.join(opts.resourcesPath, 'sub-fonts')
    : path.join(opts.dirname, '..', 'assets', 'sub-fonts');
}

/**
 * Is this live caption text real captions or the station data (XDS) that
 * ffmpeg's 608 decoder shows when its "auto" field choice locks onto field 2?
 * XDS comes out as the network or show name glued to stray bytes ("H@ABC
 * NetworkGMA 3H@", "HDDateline DaytimeHD") or short repeating pieces
 * ("HEHEHE", "CNNCNN", "HGTEHCHG"). Tuned on a 12-channel sample (2026-10-12).
 */
export function judgeCaptionText(text: string): 'ok' | 'junk' | 'unknown' {
  if (text.includes('@')) return 'junk';
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters.length < 6) return 'unknown';
  if (/\p{Ll}\p{Lu}{2}|\p{Lu}{3,}\p{Ll}/u.test(text)) return 'junk';  // case glued mid-word: "NetworkGMA", "HDDateline"
  for (const token of text.split(/\s+/)) {
    const word = token.replace(/[^\p{L}]/gu, '');
    if (word.length < 6) continue;
    if (isRepeatedUnit(word)) return 'junk';
    if (word === word.toUpperCase() && hasRepeatedBigram(word) && vowelRatio(word) < 0.25) return 'junk';
  }
  // Real captions are words with spaces. One glued run of letters ("CNNCPA",
  // the start of "CNNCPASNNCNN") proves nothing, unless it is a finished word ("COVERED?").
  const words = text.split(/\s+/).filter((t) => /\p{L}/u.test(t));
  if (words.length < 2 && !/\p{L}{4,}[.?!,]$/u.test(text.trim())) return 'unknown';
  return 'ok';
}

function isRepeatedUnit(word: string): boolean {
  // Short pieces ("HEHEHE", "CNNCNN"), or a station name looping
  // ("9NEWSKUSA9NEWSKUSA9NEWS") at least two and a half times over.
  for (let unit = 1; unit <= 12; unit++) {
    if (unit > 3 && word.length < unit * 2.5) break;
    const piece = word.slice(0, unit);
    if (piece.repeat(Math.ceil(word.length / unit)).startsWith(word)) return true;
  }
  return false;
}

function hasRepeatedBigram(word: string): boolean {
  const seen = new Set<string>();
  for (let i = 0; i + 2 <= word.length; i++) {
    const pair = word.slice(i, i + 2);
    if (seen.has(pair)) return true;
    seen.add(pair);
  }
  return false;
}

function vowelRatio(word: string): number {
  return (word.match(/[AEIOUYaeiouy]/g)?.length ?? 0) / word.length;
}

// Words that mark English, Spanish or French captions (US/Canadian broadcast
// captions are one of the three). Words the languages share ("de", "la", "que",
// "en", "un", "no") count for both; accents and ñ ¿ ¡ tip the balance.
const LANGUAGE_WORDS: Record<CaptionLanguage, Set<string>> = {
  en: new Set(['the', 'and', 'you', 'to', 'of', 'is', 'that', 'it', 'in', 'for', 'this', 'what', 'we', 'have', 'i', "i'm", "i'll", "don't", "it's", "that's", "you're", 'my', 'with', 'be', 'are', 'was', 'not', 'but', 'on', 'your', 'from', 'his', 'her', 'they', 'all', 'just', 'if', 'about', 'there', 'he', 'she', 'can', 'will', 'so', 'do', 'at', 'an', 'or']),
  es: new Set(['que', 'de', 'el', 'la', 'los', 'las', 'y', 'en', 'es', 'por', 'con', 'para', 'una', 'un', 'lo', 'se', 'del', 'está', 'esta', 'pero', 'más', 'su', 'al', 'como', 'mi', 'te', 'tu', 'estoy', 'son', 'ya', 'nada', 'tienen', 'hora', 'muy', 'sí', 'qué', 'yo', 'eso', 'este', 'hay']),
  fr: new Set(['le', 'la', 'les', 'de', 'des', 'et', 'est', 'que', 'qui', 'pas', 'pour', 'une', 'un', 'dans', 'je', 'vous', 'nous', 'ce', 'il', 'elle', 'avec', 'sur', 'au', 'en', 'du', 'ne', 'tout', 'alors', 'vos', 'contre', "qu'est", "c'est", 'mais', 'sont', 'oui', 'aux', 'cette', 'votre', 'très', 'fait']),
};

/** English, Spanish or French, from a few caption lines; unknown when the words do not say. */
export function detectCaptionLanguage(text: string): CaptionLanguage | 'unknown' {
  const lower = text.toLowerCase().replace(/[’‘]/g, "'");
  const words = lower.split(/[^\p{L}']+/u).filter(Boolean);
  const score: Record<CaptionLanguage, number> = { en: 0, es: 0, fr: 0 };
  for (const word of words) {
    for (const lang of ['en', 'es', 'fr'] as const) if (LANGUAGE_WORDS[lang].has(word)) score[lang]++;
  }
  score.es += 3 * (lower.match(/[ñ¿¡]/g)?.length ?? 0) + (lower.match(/[áíóú]/g)?.length ?? 0);
  score.fr += 2 * (lower.match(/[èàùâêîôûçœ]/g)?.length ?? 0);
  const ranked = (Object.entries(score) as Array<[CaptionLanguage, number]>).sort((a, b) => b[1] - a[1]);
  const [[best, top], [, second]] = ranked;
  return top >= 3 && top >= 2 * second ? best : 'unknown';
}

/** A fragment of station data can look like a word for a moment; this many different real lines confirm. */
const CONFIRM_LINES = 3;
/** With a language wanted, short lines that do not say which language they are in are read on up to this many. */
const LANGUAGE_LINES = 8;

/**
 * Live captions are checked in their first lines: real text ends the check,
 * station-data junk asks for a decoder restart (a fresh "auto" field choice,
 * about a coin flip on most channels), and after maxRetries the captions are
 * declared unreadable. Never second-guesses captions once they looked real.
 */
export class CaptionCheck {
  state: 'checking' | 'ok' | 'other-language' | 'unreadable' = 'checking';
  retries = 0;
  /** The language shown when only another one ever came through */
  language: CaptionLanguage | null = null;
  private otherLanguageSeen: CaptionLanguage | null = null;
  private acceptAny = false;
  private ignore: string | null = null;
  private lastText: string | null = null;
  private realLines: string[] = [];  // different real-looking lines in a row since the decoder (re)started

  /** preferred: the caption language wanted (null: any); the other field's language is flipped away from */
  constructor(private readonly maxRetries = 8, private readonly preferred: CaptionLanguage | null = null) {}

  observe(text: string): 'none' | 'ok' | 'other-language' | 'retry' | 'unreadable' {
    if (this.state !== 'checking') return 'none';
    if (this.ignore !== null) {
      if (text === this.ignore) return 'none';  // the junk lingering until the restarted decoder clears it
      this.ignore = null;
    }
    if (text === this.lastText) return 'none';  // read every few hundred ms; only changes count
    this.lastText = text;
    const verdict = judgeCaptionText(text);
    if (verdict === 'ok') {
      this.realLines.push(text);
      if (this.realLines.length < CONFIRM_LINES) return 'none';
      if (!this.preferred) {
        this.state = 'ok';
        return 'ok';
      }
      const language = detectCaptionLanguage(this.realLines.join(' / '));
      if (language === 'unknown' && this.realLines.length < LANGUAGE_LINES) return 'none';
      if (language === 'unknown' || language === this.preferred) {
        this.state = 'ok';
        return 'ok';
      }
      // Real captions, other language: the other caption field. Flip for the wanted one;
      // if the budget runs out, show these rather than nothing.
      this.otherLanguageSeen = language;
      if (this.acceptAny || this.retries >= this.maxRetries) {
        this.state = 'other-language';
        this.language = language;
        return 'other-language';
      }
      return this.restart(text);
    }
    if (verdict !== 'junk') return 'none';
    if (this.retries >= this.maxRetries) {
      if (this.otherLanguageSeen && !this.acceptAny) {
        // Only junk and the other language so far: go back for the other language.
        this.acceptAny = true;
        this.retries = 0;
        return this.restart(text);
      }
      this.state = 'unreadable';
      return 'unreadable';
    }
    return this.restart(text);
  }

  private restart(text: string): 'retry' {
    this.realLines = [];
    this.retries++;
    this.ignore = text;
    return 'retry';
  }
}
