// Rewind live TV in the player bar: stream time ↔ clock, the bar's geometry,
// the LIVE pill, and the setting's wording. Pure, so it is unit tested.
import type { RewindStateUpdate } from '../types/electron';

const GIB = 1024 ** 3;
const HD_BPS = 5_000_000 / 8;
const UHD_BPS = 20_000_000 / 8;
/** Caught up to within this of the live point: LIVE again. */
const LIVE_SLACK_S = 2;

export interface ClockAnchor { streamT: number; wallMs: number }

/** The live edge is "now": pin it to the clock once per load. */
export function anchorFor(state: RewindStateUpdate, nowMs: number): ClockAnchor {
  return { streamT: state.liveEdge, wallMs: nowMs };
}

export function wallAt(anchor: ClockAnchor, t: number): number {
  return anchor.wallMs + (t - anchor.streamT) * 1000;
}

export interface RewindBar {
  gonePct: number;     // dotted: show start → oldest reachable
  tintFrom: number;    // reachable stretch
  tintTo: number;
  fillTo: number;      // watched part of the reachable stretch (= headPct)
  tickPct: number;     // where rewind starts
  edgePct: number;     // live edge
  headPct: number;     // playhead
  reachesEarlierShow: boolean;
  /** No guide data: the bar is the buffer itself */
  spansBuffer: boolean;
}

const clampPct = (x: number) => Math.min(100, Math.max(0, x));

/**
 * Where "live" is: mpv plays a cushion (lagS) behind the newest data it holds;
 * jumping to the very edge would leave it nothing to play and it would stall.
 */
export function liveTarget(state: RewindStateUpdate, lagS: number): number {
  return Math.max(state.rangeStart, state.liveEdge - lagS);
}

export function rewindBar({ state, anchor, position, program, lagS = 0 }: {
  state: RewindStateUpdate; anchor: ClockAnchor; position: number; program: { startMs: number; endMs: number } | null;
  /** mpv's natural distance behind the newest data (see liveTarget) */
  lagS?: number;
}): RewindBar {
  const startWall = wallAt(anchor, state.rangeStart);
  const liveWall = wallAt(anchor, liveTarget(state, lagS));
  const headWall = wallAt(anchor, position);
  const show = program && program.endMs > program.startMs ? program : null;
  const from = show ? show.startMs : startWall;
  const to = show ? show.endMs : liveWall;
  const pct = (ms: number) => (to > from ? clampPct(((ms - from) / (to - from)) * 100) : 0);
  const tickPct = pct(startWall);
  const headPct = pct(headWall);
  return {
    gonePct: tickPct,
    tintFrom: tickPct,
    tintTo: pct(liveWall),
    fillTo: headPct,
    tickPct,
    edgePct: pct(liveWall),
    headPct,
    reachesEarlierShow: show !== null && startWall < show.startMs,
    spansBuffer: show === null,
  };
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/**
 * atLive: the user has not paused or seeked back since tuning in or jumping to
 * live, so it says LIVE whatever the measured distance (mpv's cushion moves with
 * network bursts; a number would flicker). Behind, it counts.
 */
export function pillText(state: RewindStateUpdate, position: number, lagS = 0, atLive = false): { live: boolean; text: string } {
  if (atLive) return { live: true, text: 'LIVE' };
  const behind = liveTarget(state, lagS) - position;
  if (behind < LIVE_SLACK_S) return { live: true, text: 'LIVE' };
  return { live: false, text: `−${clock(behind)} · LIVE` };
}

/** Whole minutes; from 10 min up, the nearest 5 (the channel's rate moves, so finer would only flicker). */
function minutes(bytes: number, bps: number): string {
  const exact = bytes / bps / 60;
  const total = exact >= 10 ? Math.round(exact / 5) * 5 : Math.floor(exact);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? (m > 0 ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

/**
 * The setting's help line: typical HD/4K, or the channel playing now when its rate is known.
 * The size is memory; mpv gets half of it as stream data (it holds about twice its own count).
 */
export function estimateText(bytes: number, bytesPerSecond?: number): string {
  const streamBytes = bytes / 2;
  if (bytesPerSecond && bytesPerSecond > 0) return `About ${minutes(streamBytes, bytesPerSecond)} on this channel.`;
  return `About ${minutes(streamBytes, HD_BPS)} of an HD channel, or ${minutes(streamBytes, UHD_BPS)} of 4K.`;
}

export const REWIND_PRESETS = [
  { id: '512', bytes: 0.5 * GIB, label: '512 MB' },
  { id: '2048', bytes: 2 * GIB, label: '2 GB' },
  { id: '8192', bytes: 8 * GIB, label: '8 GB' },
];

export function presetsUnderCap(capBytes: number) {
  return REWIND_PRESETS.filter((p) => p.bytes <= capBytes);
}

/** Custom size in GB: 0.5 steps, at least 0.5, at most the cap. */
export function stepCustomGb(gb: number, capBytes: number): number {
  const capGb = capBytes / GIB;
  const stepped = Math.floor(gb * 2) / 2;
  return Math.min(capGb, Math.max(0.5, stepped));
}

/** The one-time "turn on rewind" tip: the first time live TV is paused with rewind off. */
export function shouldShowRewindTip({ pausingLive, rewindBytes, tipShown }: { pausingLive: boolean; rewindBytes: number; tipShown: boolean }): boolean {
  return pausingLive && rewindBytes <= 0 && !tipShown;
}

/** A dragged playhead stays on the part of the bar that can be played. */
export function clampToReach(pct: number, bar: Pick<RewindBar, 'tintFrom' | 'tintTo'>): number {
  return Math.min(Math.max(pct, bar.tintFrom), bar.tintTo);
}

/** How far the clock-advanced live edge may stray from mpv's last report. */
export const EDGE_TRACK_S = 5;

/**
 * The live edge now: advanced with the clock since the anchor, so the distance
 * behind stays steady between mpv's once-a-second reports (which arrive in
 * network bursts), but never more than EDGE_TRACK_S from what mpv reported.
 */
export function liveEdgeAt(state: RewindStateUpdate, anchor: ClockAnchor, nowMs: number): number {
  const clockEdge = anchor.streamT + (nowMs - anchor.wallMs) / 1000;
  return Math.min(Math.max(clockEdge, state.liveEdge - EDGE_TRACK_S), state.liveEdge + EDGE_TRACK_S);
}

/**
 * The ‹ / › buttons at the bar's ends (stream seconds to seek to, or null when
 * there is nothing that way): earlier = the buffer reaches before the show on
 * screen (go to the oldest kept moment); later = live has moved past the show on
 * screen (go just after it ends).
 */
export function showNav({ state, anchor, lagS, program }: {
  state: RewindStateUpdate; anchor: ClockAnchor; lagS: number; program: { startMs: number; endMs: number } | null;
}): { earlier: number | null; later: number | null } {
  if (!program || program.endMs <= program.startMs) return { earlier: null, later: null };
  const live = liveTarget(state, lagS);
  const streamAt = (ms: number) => anchor.streamT + (ms - anchor.wallMs) / 1000;
  return {
    earlier: wallAt(anchor, state.rangeStart) < program.startMs ? state.rangeStart : null,
    later: wallAt(anchor, live) > program.endMs ? Math.min(streamAt(program.endMs) + 1, live) : null,
  };
}
