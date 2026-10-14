// Subtitles and live captions: the pure parts (settings, mpv track list,
// style options, when to read the track list). No electron imports, so it
// runs under node:test. mpv draws the subtitles in both players; main only
// configures it and tells the renderer which tracks exist.

import path from 'node:path';

export type SubtitleSize = 'small' | 'medium' | 'large';
export type SubtitleStyle = 'outline' | 'box' | 'shadow';
export interface SubtitleSettings {
  liveDefault: boolean;  // live captions on when a channel starts
  vodDefault: boolean;   // movie & series subtitles on when one starts
  size: SubtitleSize;
  style: SubtitleStyle;
}

const SIZES: readonly SubtitleSize[] = ['small', 'medium', 'large'];
const STYLES: readonly SubtitleStyle[] = ['outline', 'box', 'shadow'];

export function normalizeSubtitleSettings(value: unknown): SubtitleSettings {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    liveDefault: v.liveDefault === true,
    vodDefault: v.vodDefault === true,
    size: SIZES.find(s => s === v.size) ?? 'medium',
    style: STYLES.find(s => s === v.style) ?? 'outline',
  };
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
  for (let unit = 1; unit <= 3; unit++) {
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

/** A fragment of station data can look like a word for a moment; this many different real lines confirm. */
const CONFIRM_LINES = 3;

/**
 * Live captions are checked in their first lines: real text ends the check,
 * station-data junk asks for a decoder restart (a fresh "auto" field choice,
 * about a coin flip on most channels), and after maxRetries the captions are
 * declared unreadable. Never second-guesses captions once they looked real.
 */
export class CaptionCheck {
  state: 'checking' | 'ok' | 'unreadable' = 'checking';
  retries = 0;
  private ignore: string | null = null;
  private lastText: string | null = null;
  private realLines = 0;  // different real-looking lines in a row; CONFIRM_LINES confirms the captions

  constructor(private readonly maxRetries = 8) {}

  observe(text: string): 'none' | 'ok' | 'retry' | 'unreadable' {
    if (this.state !== 'checking') return 'none';
    if (this.ignore !== null) {
      if (text === this.ignore) return 'none';  // the junk lingering until the restarted decoder clears it
      this.ignore = null;
    }
    if (text === this.lastText) return 'none';  // read every few hundred ms; only changes count
    this.lastText = text;
    const verdict = judgeCaptionText(text);
    if (verdict === 'ok') {
      if (++this.realLines < CONFIRM_LINES) return 'none';
      this.state = 'ok';
      return 'ok';
    }
    if (verdict !== 'junk') return 'none';
    this.realLines = 0;
    if (this.retries >= this.maxRetries) {
      this.state = 'unreadable';
      return 'unreadable';
    }
    this.retries++;
    this.ignore = text;
    return 'retry';
  }
}
