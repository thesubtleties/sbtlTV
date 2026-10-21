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

/** UTF-8 (with or without BOM) and UTF-16 by BOM; anything not valid UTF-8 is read as Windows-1252. */
export function decodeSubtitle(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return new TextDecoder('windows-1252').decode(body);
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
 * enough apart, solve speed and delay together (fixes drift); a speed outside
 * 0.9-1.1 is not a frame-rate mismatch, so only the delay changes.
 */
export function solveSync(points: SyncPoint[], speed: number): { delay: number; speed: number } {
  const last = points[points.length - 1];
  const prev = points.length >= 2 ? points[points.length - 2] : undefined;
  if (prev && Math.abs(last.cueStart - prev.cueStart) >= MIN_SPAN_S) {
    const s = (last.at - prev.at) / (last.cueStart - prev.cueStart);
    if (s >= 0.9 && s <= 1.1) return { speed: s, delay: prev.at - prev.cueStart * s };
  }
  return { speed, delay: last.at - last.cueStart * speed };
}
