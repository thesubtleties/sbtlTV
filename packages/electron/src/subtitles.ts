// Subtitles and live captions: the pure parts (settings, mpv track list,
// style options, when to read the track list). No electron imports, so it
// runs under node:test. mpv draws the subtitles in both players; main only
// configures it and tells the renderer which tracks exist.

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

/** mpv keeps the selected track and sub-delay across loadfile; reset both before each load. */
export function loadResetOptions(): Array<[string, string]> {
  return [['sid', 'no'], ['sub-delay', '0']];
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
