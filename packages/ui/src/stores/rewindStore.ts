/**
 * Rewind live TV: the reachable range main reports once a second, and the
 * clock anchor for this load. Only the player bar subscribes; keys and the
 * reconnect toast read it with getState().
 */

import { create } from 'zustand';
import type { RewindStateUpdate } from '../types/electron';
import { anchorFor, EDGE_TRACK_S, liveTarget, type ClockAnchor } from '../utils/rewindModel';

/** Least cushion "live" keeps, so jumping to live never leaves mpv nothing to play. */
const LAG_FLOOR_S = 3;
/** Re-anchor after the reported edge has stayed this far off the clock for DRIFT_REPORTS reports (bursts pass). */
const DRIFT_REPORTS = 3;
/** A jump this big (encoder restart) re-anchors at once. */
const CLOCK_JUMP_S = 30;
/** mpv's cushion settles within the first seconds of playing; measuring later would pick up stalls and drift. */
const LAG_MEASURE_PLAYING_S = 30;

interface RewindStore {
  state: RewindStateUpdate | null;
  anchor: ClockAnchor | null;
  /** mpv's natural distance behind the newest data, measured while playing until the first pause or seek */
  lagS: number;
  /** Lag measurement is over for this load (paused, seeked, or settled) */
  lagFrozen: boolean;
  /** Reports counted while playing, for the settle window */
  playingReports: number;
  /** The load media-loaded announced last; reports from other loads are stale */
  expectedGeneration: number | null;
  lastReportMs: number;
  /** The channel's rate, smoothed across reports (each moves it 10 %), for the setting's estimate */
  rateBps: number;
  /** At live: nothing since tuning in or jumping to live has put the viewer behind (pause, seek back) */
  atLive: boolean;
  /** Reports in a row with the reported edge off the clock by more than EDGE_TRACK_S */
  driftReports: number;
  /** This load has rewind (main said so at load), though its first report may not have come yet */
  expected: boolean;
  /** A new load was announced: reports from earlier loads are ignored from now on. */
  beginLoad: (generation: number, rewind?: boolean) => void;
  /** A new generation re-anchors stream time to the clock; null = rewind not active. */
  apply: (update: RewindStateUpdate | null, nowMs: number, position?: number, playing?: boolean) => void;
  /** The user seeked: from now on the distance behind live is theirs, not mpv's cushion. Up to the live point is live. */
  noteSeek: (target?: number) => void;
  /** The user paused: the growing distance is theirs too. */
  notePause: () => void;
}

const cleared = { state: null, anchor: null, lagS: LAG_FLOOR_S, lagFrozen: false, playingReports: 0, lastReportMs: 0, driftReports: 0, atLive: true, rateBps: 0, expected: false };

export const useRewindStore = create<RewindStore>((set, get) => ({
  ...cleared,
  expectedGeneration: null,
  beginLoad: (generation, rewind = false) => set({ ...cleared, expectedGeneration: generation, expected: rewind }),
  apply: (update, nowMs, position = 0, playing = true) => {
    if (!update) { set(cleared); return; }
    const prev = get();
    if (prev.expectedGeneration !== null && update.generation !== prev.expectedGeneration) return;
    const sameLoad = prev.state !== null && prev.anchor !== null && prev.state.generation === update.generation;
    if (!sameLoad) {
      const measuring = playing && position > 0;
      set({
        state: update, anchor: anchorFor(update, nowMs), lastReportMs: nowMs, lagFrozen: false, driftReports: 0, atLive: true,
        rateBps: update.bytesPerSecond,
        playingReports: measuring ? 1 : 0,
        lagS: measuring ? Math.max(LAG_FLOOR_S, update.liveEdge - position) : LAG_FLOOR_S,
      });
      return;
    }
    // Keep the clock-advanced edge (liveEdgeAt) close to what mpv reports: re-anchor when they drift
    // apart (the provider's opening burst, a stream clock slightly off the wall clock, an encoder restart).
    // A one-off burst passes; a drift that lasts, or a jump, moves the anchor.
    const drift = Math.abs(prev.anchor!.streamT + (nowMs - prev.anchor!.wallMs) / 1000 - update.liveEdge);
    const driftReports = drift > EDGE_TRACK_S ? prev.driftReports + 1 : 0;
    const reanchor = drift > CLOCK_JUMP_S || driftReports >= DRIFT_REPORTS;
    const anchor = reanchor ? anchorFor(update, nowMs) : prev.anchor;
    let { lagS, lagFrozen, playingReports } = prev;
    if (!lagFrozen && playing && position > 0) {
      lagS = Math.max(LAG_FLOOR_S, update.liveEdge - position);
      playingReports += 1;
      if (playingReports > LAG_MEASURE_PLAYING_S) lagFrozen = true;
    }
    const rateBps = prev.rateBps > 0 ? prev.rateBps * 0.9 + update.bytesPerSecond * 0.1 : update.bytesPerSecond;
    set({ state: update, anchor, lastReportMs: nowMs, lagS, lagFrozen, playingReports, driftReports: reanchor ? 0 : driftReports, rateBps });
  },
  noteSeek: (target) => {
    const { state, lagS } = get();
    const atLive = target !== undefined && state !== null && target >= liveTarget(state, lagS) - 1;
    set({ lagFrozen: true, atLive });
  },
  notePause: () => set({ lagFrozen: true, atLive: false }),
}));
