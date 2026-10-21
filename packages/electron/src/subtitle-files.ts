// Subtitle files main downloaded: decode to text, recognise the format by
// content, parse cues (for the sync panel and the timing check), and the sync
// maths. mpv draws the subtitles; this only reads them. No electron imports,
// so it runs under node:test.
//
// mpv shows a cue at video time start * sub-speed + sub-delay.

export type SubtitleFormat = 'srt' | 'vtt' | 'ass';
export interface Cue { start: number; end: number; text: string }
export interface TimingStatus { speed: number | null; fps: { from: number; to: number } | null; cutMismatch: boolean }
/** A line the viewer picked: where it sits in the file, and the video time it was heard at */
export interface SyncPoint { cueStart: number; at: number }
export const SUBTITLE_EXT: Record<SubtitleFormat, string> = { srt: 'srt', vtt: 'vtt', ass: 'ass' };

/** The legacy code page a subtitle in this language is most likely saved in when it is not UTF-8. */
const LEGACY_ENCODING: Record<string, string> = {
  ar: 'windows-1256', fa: 'windows-1256', ur: 'windows-1256',
  ru: 'windows-1251', uk: 'windows-1251', bg: 'windows-1251', sr: 'windows-1251',
  el: 'windows-1253', he: 'windows-1255', tr: 'windows-1254',
  pl: 'windows-1250', cs: 'windows-1250', hu: 'windows-1250', ro: 'windows-1250', hr: 'windows-1250', sl: 'windows-1250',
  'zh-cn': 'gb18030', 'zh-tw': 'big5', ja: 'shift_jis', ko: 'euc-kr', th: 'windows-874', vi: 'windows-1258',
};

/**
 * UTF-8 (with or without BOM) and UTF-16 by BOM. Anything else is read in the
 * code page usual for the subtitle's language (settings code), else Windows-1252.
 */
export function decodeSubtitle(bytes: Uint8Array, language = ''): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return new TextDecoder(LEGACY_ENCODING[language] ?? 'windows-1252').decode(body);
  }
}

const SRT_TIME = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;
const VTT_TIME = /((?:\d+:)?\d{2}:\d{2}\.\d{3})\s*-->\s*((?:\d+:)?\d{2}:\d{2}\.\d{3})/;
const ASS_TIME = /(\d+):(\d{2}):(\d{2})\.(\d{1,2})/;

/** The format from the text itself; null for anything that is not a subtitle (an error page, JSON, an archive). */
export function sniffFormat(text: string): SubtitleFormat | null {
  const head = text.slice(0, 4096).replace(/^﻿/, '').trimStart();
  if (!head || head.startsWith('<') || head.startsWith('{') || head.startsWith('PK')) return null;
  if (head.startsWith('WEBVTT')) return 'vtt';
  if (/^\[Script Info\]/i.test(head) || /^\[Events\]/im.test(head)) return 'ass';
  if (SRT_TIME.test(head)) return 'srt';
  return null;
}

const seconds = (h: string, m: string, s: string, ms: string) => Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000;
const stripTags = (t: string) => t.replace(/<[^>]+>/g, '').replace(/\{[^}]*\}/g, '');
const clean = (lines: string[]) => stripTags(lines.join('\n')).split('\n').map((l) => l.trim()).filter(Boolean).join('\n');

function vttSeconds(t: string): number {
  const p = t.split(':').map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
}

function parseAss(lines: string[]): Cue[] {
  const cues: Cue[] = [];
  let fields: string[] | null = null;
  for (const line of lines) {
    if (fields === null && /^Format:/i.test(line)) {
      const f = line.slice(7).split(',').map((x) => x.trim().toLowerCase());
      if (f.includes('text')) fields = f;
      continue;
    }
    if (!fields || !/^Dialogue:/i.test(line)) continue;
    const parts = line.slice(9).split(',');
    const at = (name: string) => (parts[fields!.indexOf(name)] ?? '').trim();
    const time = (v: string) => {
      const m = ASS_TIME.exec(v);
      return m ? seconds(m[1], m[2], m[3], m[4].padEnd(2, '0') + '0') : NaN;
    };
    const start = time(at('start'));
    const end = time(at('end'));
    const raw = parts.slice(fields.indexOf('text')).join(',').replace(/\\N|\\n/g, '\n');
    if (Number.isFinite(start) && Number.isFinite(end)) cues.push({ start, end, text: clean(raw.split('\n')) });
  }
  return cues;
}

/** Cues sorted by start, text without formatting tags. */
export function parseCues(text: string, format: SubtitleFormat): Cue[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (format === 'ass') return parseAss(lines).sort((a, b) => a.start - b.start);
  const cues: Cue[] = [];
  for (let i = 0; i < lines.length; i++) {
    let start: number;
    let end: number;
    if (format === 'srt') {
      const m = SRT_TIME.exec(lines[i]);
      if (!m) continue;
      start = seconds(m[1], m[2], m[3], m[4]);
      end = seconds(m[5], m[6], m[7], m[8]);
    } else {
      const m = VTT_TIME.exec(lines[i]);
      if (!m) continue;
      start = vttSeconds(m[1]);
      end = vttSeconds(m[2]);
    }
    const body: string[] = [];
    while (i + 1 < lines.length && lines[i + 1].trim() !== '') body.push(lines[++i]);
    cues.push({ start, end, text: clean(body) });
  }
  return cues.sort((a, b) => a.start - b.start);
}

const MAX_ASS_EVENTS = 20_000;
const ASS_CAPS: Array<[RegExp, number]> = [[/\\blur(\d+(?:\.\d+)?)/g, 20], [/\\be(\d+(?:\.\d+)?)/g, 20], [/\\fs(\d+(?:\.\d+)?)/g, 200]];

/**
 * A downloaded ASS file, made safe for libass (it runs in the app's main
 * process): embedded fonts and graphics dropped, extreme blur and font sizes
 * capped, at most 20,000 events.
 */
export function sanitizeAss(text: string): string {
  const out: string[] = [];
  let skipping = false;
  let events = 0;
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const section = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (section) skipping = /^(fonts|graphics)$/i.test(section[1].trim());
    if (skipping) continue;
    if (/^Dialogue:/i.test(line)) {
      if (++events > MAX_ASS_EVENTS) continue;
      let capped = line;
      for (const [re, max] of ASS_CAPS) capped = capped.replace(re, (m, v) => (Number(v) > max ? m.replace(v, String(max)) : m));
      out.push(capped);
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

/** A line with nothing to hear as speech: [MUSIC], (laughs), ♪ lyrics ♪, a speaker label alone. */
export function isSoundCue(text: string): boolean {
  const rest = text
    .replace(/\[[^\]]*\]|\([^)]*\)/g, '')
    .replace(/♪[^♪]*♪|[♪♫#]/g, '')
    .replace(/^[-\s]*[A-Z][A-Z .'-]{1,30}:\s*$/gm, '')
    .replace(/[\s\-–—.,!?]/g, '');
  return rest.length === 0;
}

const FPS_PAIRS: Array<[number, number]> = [[25, 23.976], [25, 24], [24, 23.976]];

/**
 * Wrong speed: the last line runs past the video's end by about a classic
 * frame-rate ratio (a 25 fps subtitle on a 23.976 fps video); the window
 * allows for end credits. The opposite case looks like normal credits, so it
 * is left to Sync. Different cut: last line more than 3 min past the end, or
 * ending before 60% of the video.
 */
export function timingCheck(cues: Cue[], videoDuration: number): TimingStatus {
  const none: TimingStatus = { speed: null, fps: null, cutMismatch: false };
  if (cues.length === 0 || !(videoDuration > 0)) return none;
  const last = cues.reduce((max, c) => Math.max(max, c.end), 0);
  const ratio = last / videoDuration;
  if (last > videoDuration) {
    for (const [from, to] of FPS_PAIRS) {
      const expected = from / to;
      if (ratio >= expected * 0.92 && ratio <= expected * 1.005) return { speed: to / from, fps: { from, to }, cutMismatch: false };
    }
  }
  return { ...none, cutMismatch: last > videoDuration + 180 || last < videoDuration * 0.6 };
}

/** Points closer than this only set the delay: too short a span to measure speed. */
const MIN_SPAN_S = 60;

/**
 * One picked line sets the delay at the current speed. The last two, far
 * enough apart, set the speed too when it is a frame-rate mismatch (25 vs
 * 23.976 fps...); any other difference is a scene cut, so only the delay changes.
 * opts.speed false: delay only (a subtitle for another cut).
 */
/** Speeds a subtitle can be off by: a frame-rate mismatch (25, 24 and 23.976 fps), either way. */
const SYNC_SPEEDS = [25 / 24, 25 / 23.976, 24 / 23.976].flatMap((r) => [r, 1 / r]);

export function solveSync(points: SyncPoint[], speed: number, opts: { speed?: boolean } = {}): { delay: number; speed: number } {
  const last = points[points.length - 1];
  const prev = points.length >= 2 ? points[points.length - 2] : undefined;
  if (opts.speed !== false && prev && Math.abs(last.cueStart - prev.cueStart) >= MIN_SPAN_S) {
    const measured = (last.at - prev.at) / (last.cueStart - prev.cueStart);
    // Only a real frame-rate ratio is a speed; anything else is a scene cut between the taps (delay only)
    const closest = SYNC_SPEEDS.reduce((best, r) => (Math.abs(measured - r) < Math.abs(measured - best) ? r : best));
    const ratio = Math.abs(measured - closest) / closest <= 0.003 ? closest : undefined;
    if (ratio !== undefined) return { speed: ratio, delay: last.at - last.cueStart * ratio };
  }
  return { speed, delay: last.at - last.cueStart * speed };
}
