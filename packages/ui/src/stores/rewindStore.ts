/**
 * Rewind live TV: the reachable range main reports once a second, and the
 * clock anchor for this load. Only the player bar subscribes; keys and the
 * reconnect toast read it with getState().
 */

import { create } from 'zustand';
import type { RewindStateUpdate } from '../types/electron';
import { anchorFor, type ClockAnchor } from '../utils/rewindModel';

/** Least cushion "live" keeps, so jumping to live never leaves mpv nothing to play. */
const LAG_FLOOR_S = 3;
/** mpv's cushion settles within the first seconds of playing; measuring later would pick up stalls and drift. */
const LAG_MEASURE_PLAYING_S = 30;
/** The stream clock moved this much more (or less) than the wall clock between two reports: re-anchor. */
const CLOCK_JUMP_S = 30;

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
  /** A new load was announced: reports from earlier loads are ignored from now on. */
  beginLoad: (generation: number) => void;
  /** A new generation re-anchors stream time to the clock; null = rewind not active. */
  apply: (update: RewindStateUpdate | null, nowMs: number, position?: number, playing?: boolean) => void;
  /** The user seeked: from now on the distance behind live is theirs, not mpv's cushion. */
  noteSeek: () => void;
  /** The user paused: the growing distance is theirs too. */
  notePause: () => void;
}

const cleared = { state: null, anchor: null, lagS: LAG_FLOOR_S, lagFrozen: false, playingReports: 0, lastReportMs: 0 };

export const useRewindStore = create<RewindStore>((set, get) => ({
  ...cleared,
  expectedGeneration: null,
  beginLoad: (generation) => set({ ...cleared, expectedGeneration: generation }),
  apply: (update, nowMs, position = 0, playing = true) => {
    if (!update) { set(cleared); return; }
    const prev = get();
    if (prev.expectedGeneration !== null && update.generation !== prev.expectedGeneration) return;
    const sameLoad = prev.state !== null && prev.anchor !== null && prev.state.generation === update.generation;
    if (!sameLoad) {
      const measuring = playing && position > 0;
      set({
        state: update, anchor: anchorFor(update, nowMs), lastReportMs: nowMs, lagFrozen: false,
        playingReports: measuring ? 1 : 0,
        lagS: measuring ? Math.max(LAG_FLOOR_S, update.liveEdge - position) : LAG_FLOOR_S,
      });
      return;
    }
    // The stream's timestamps jumped (encoder restart): the old anchor would put every time off by the jump.
    const streamAdvance = update.liveEdge - prev.state!.liveEdge;
    const wallAdvance = (nowMs - prev.lastReportMs) / 1000;
    const anchor = Math.abs(streamAdvance - wallAdvance) > CLOCK_JUMP_S ? anchorFor(update, nowMs) : prev.anchor;
    let { lagS, lagFrozen, playingReports } = prev;
    if (!lagFrozen && playing && position > 0) {
      lagS = Math.max(LAG_FLOOR_S, update.liveEdge - position);
      playingReports += 1;
      if (playingReports > LAG_MEASURE_PLAYING_S) lagFrozen = true;
    }
    set({ state: update, anchor, lastReportMs: nowMs, lagS, lagFrozen, playingReports });
  },
  noteSeek: () => set({ lagFrozen: true }),
  notePause: () => set({ lagFrozen: true }),
}));
