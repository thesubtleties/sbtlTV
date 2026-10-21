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

export function trackLabel(track: SubtitleTrack): string {
  if (track.isCc) return 'Closed captions';
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
