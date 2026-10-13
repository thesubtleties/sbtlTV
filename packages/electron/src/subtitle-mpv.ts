// Subtitles in mpv: the options main sets (base, per-load reset, style), the
// track list mpv reports, and when to read it. No electron imports, so it runs
// under node:test. mpv draws the subtitles in both players; main only
// configures it and tells the renderer which tracks exist.

import path from 'node:path';
import type { SubtitleSettings, SubtitleSize } from './subtitle-settings.js';

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
