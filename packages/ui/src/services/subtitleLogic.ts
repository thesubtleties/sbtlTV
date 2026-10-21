/**
 * Pure subtitle decisions, kept out of components so they can be unit tested.
 */
import type { SubtitleTrack } from '../types/electron';

export type SubtitleKind = 'live' | 'vod';

const DELAY_LIMIT = 60;

/** ISO 639-2 codes mpv reports for the languages a system locale is likely to be in. */
const ISO_639_2: Record<string, string[]> = {
  en: ['eng'], es: ['spa'], fr: ['fre', 'fra'], de: ['ger', 'deu'], it: ['ita'], pt: ['por'],
  nl: ['dut', 'nld'], sv: ['swe'], no: ['nor', 'nob'], da: ['dan'], fi: ['fin'], pl: ['pol'],
  ru: ['rus'], tr: ['tur'], ar: ['ara'], ja: ['jpn'], ko: ['kor'], zh: ['chi', 'zho'],
};

/** A two-letter language and the ISO 639-2 codes mpv may tag its tracks with. */
export function isoForPrimary(primary: string): string[] {
  return [primary, ...(ISO_639_2[primary] ?? [])];
}

function matchesLocale(lang: string | null, locale: string): boolean {
  if (!lang) return false;
  const primary = locale.toLowerCase().split(/[-_]/)[0];
  const l = lang.toLowerCase();
  return l === primary || (ISO_639_2[primary] ?? []).includes(l);
}

/** Track to turn on: live = the CC track; vod = system language, else first. */
export function pickSubtitleTrack(tracks: SubtitleTrack[], kind: SubtitleKind, locale: string): number | null {
  if (tracks.length === 0) return null;
  if (kind === 'live') return (tracks.find(t => t.isCc) ?? tracks[0]).id;
  return (tracks.find(t => matchesLocale(t.lang, locale)) ?? tracks[0]).id;
}

/** The movie's track in the locale's language, or null when it has none (no fallback). */
export function localeSubtitleTrack(tracks: SubtitleTrack[], locale: string): number | null {
  return tracks.find(t => matchesLocale(t.lang, locale))?.id ?? null;
}

export function stepDelay(current: number, delta: number): number {
  const next = Math.round((current + delta) * 10) / 10;
  return Math.min(Math.max(next, -DELAY_LIMIT), DELAY_LIMIT) || 0;  // || 0 turns -0 into 0
}

export function formatDelay(seconds: number): string {
  if (seconds === 0) return '0.0s';
  return `${seconds > 0 ? '+' : ''}${seconds.toFixed(1)}s`;
}

const LANGUAGE_NAMES = new Intl.DisplayNames(['en'], { type: 'language' });

/** downloadedLanguage: the language a SubDL track was downloaded in (mpv only knows its file name). */
export function trackLabel(track: SubtitleTrack, downloadedLanguage?: string): string {
  if (track.isCc) return 'Closed captions';
  if (track.external) return downloadedLanguage ?? 'Downloaded subtitles';
  if (track.title) return track.title;
  if (track.lang && track.lang !== 'und') {
    try {
      const name = LANGUAGE_NAMES.of(track.lang);
      if (name && name !== track.lang) return name;
    } catch { /* unknown code: fall through */ }
  }
  return `Subtitles ${track.id}`;
}

/** A subtitle choice saved with watch progress: a SubDL file and its timing. */
export interface SavedSubtitle { subdlId: string | null; ai: boolean; delay: number; speed: number; duration: number }
export type VodDecision = { kind: 'track'; id: number } | { kind: 'subdl'; nId: string } | { kind: 'off' };

/**
 * Which subtitle a movie or episode starts with when subtitles are on.
 * subdl: a SubDL key is set and the title has a TMDB match. Without it, as
 * before: the track in the language, else the first, else none.
 *   1. the SubDL file saved for this title
 *   2. a downloaded track already loaded in this playback
 *   3. SDH preferred: a built-in track flagged SDH in the language, else SubDL
 *   4. a built-in track in the language (it matches the video best)
 *   5. SubDL's best match
 */
export function decideVodSubtitle(
  tracks: SubtitleTrack[],
  o: { languageIso: string[]; preferSdh: boolean; subdl: boolean; saved: SavedSubtitle | null },
): VodDecision {
  const inLanguage = tracks.filter((t) => !t.external && t.lang !== null && o.languageIso.includes(t.lang.toLowerCase()));
  if (o.subdl) {
    if (o.saved?.subdlId) return { kind: 'subdl', nId: o.saved.subdlId };
    const downloaded = tracks.find((t) => t.external);
    if (downloaded) return { kind: 'track', id: downloaded.id };
    if (o.preferSdh) {
      const sdh = inLanguage.find((t) => t.hearingImpaired);
      return sdh ? { kind: 'track', id: sdh.id } : { kind: 'subdl', nId: 'auto' };
    }
    return inLanguage.length > 0 ? { kind: 'track', id: inLanguage[0].id } : { kind: 'subdl', nId: 'auto' };
  }
  if (inLanguage.length > 0) return { kind: 'track', id: inLanguage[0].id };
  return tracks.length > 0 ? { kind: 'track', id: tracks[0].id } : { kind: 'off' };
}

/** A line picked in the Sync panel: its start in the file, and the video time it was heard at. */
export interface SyncPoint { cueStart: number; at: number }

/** Speeds a subtitle can be off by: a frame-rate mismatch (25, 24 and 23.976 fps), either way. */
const SYNC_SPEEDS = [25 / 24, 25 / 23.976, 24 / 23.976].flatMap((r) => [r, 1 / r]);

/**
 * mpv shows a line at start * speed + delay. One picked line sets the delay
 * at the current speed; the last two, at least 60 s apart, set the speed too
 * when it is a frame-rate mismatch, else (a scene cut) only the delay.
 * opts.speed false: delay only. Same maths as main's subtitle-files.ts.
 */
export function solveSync(points: SyncPoint[], speed: number, opts: { speed?: boolean } = {}): { delay: number; speed: number } {
  const last = points[points.length - 1];
  const prev = points.length >= 2 ? points[points.length - 2] : undefined;
  if (opts.speed !== false && prev && Math.abs(last.cueStart - prev.cueStart) >= 60) {
    const measured = (last.at - prev.at) / (last.cueStart - prev.cueStart);
    const closest = SYNC_SPEEDS.reduce((best, r) => (Math.abs(measured - r) < Math.abs(measured - best) ? r : best));
    const ratio = Math.abs(measured - closest) / closest <= 0.003 ? closest : undefined;
    if (ratio !== undefined) return { speed: ratio, delay: last.at - last.cueStart * ratio };
  }
  return { speed, delay: last.at - last.cueStart * speed };
}

/** The CC menu's SubDL line. */
export function subdlStatusText(status: 'quota' | 'not-found' | 'auth' | 'cut' | { fps: { from: number; to: number } } | null): string | null {
  if (status === null) return null;
  if (typeof status === 'object') return `Speed fixed (${status.fps.from} → ${status.fps.to} fps)`;
  return {
    quota: 'No SubDL downloads left today',
    'not-found': 'No subtitles found on SubDL',
    auth: 'SubDL key not accepted',
    cut: 'Timing may be off · Find another or Sync',
  }[status];
}

/** How long after a line starts people tap it in Sync (hear, recognise, press). */
export const SYNC_REACTION_S = 0.3;

/** The video time a tapped line was actually heard: the tap, less the reaction time. */
export function heardAt(tapPosition: number): number {
  return tapPosition - SYNC_REACTION_S;
}
