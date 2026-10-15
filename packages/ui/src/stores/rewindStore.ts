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

interface RewindStore {
  state: RewindStateUpdate | null;
  anchor: ClockAnchor | null;
  /** mpv's natural distance behind the newest data, measured until the first seek of the load */
  lagS: number;
  seeked: boolean;
  /** A new generation re-anchors stream time to the clock; null = rewind not active. */
  apply: (update: RewindStateUpdate | null, nowMs: number, position?: number) => void;
  /** The user seeked: from now on the distance behind live is theirs, not mpv's cushion. */
  noteSeek: () => void;
}

export const useRewindStore = create<RewindStore>((set, get) => ({
  state: null,
  anchor: null,
  lagS: LAG_FLOOR_S,
  seeked: false,
  apply: (update, nowMs, position = 0) => {
    if (!update) { set({ state: null, anchor: null, lagS: LAG_FLOOR_S, seeked: false }); return; }
    const { state: prev, anchor: prevAnchor, lagS: prevLag, seeked: prevSeeked } = get();
    const sameLoad = prev !== null && prevAnchor !== null && prev.generation === update.generation;
    const seeked = sameLoad ? prevSeeked : false;
    const measured = position > 0 ? Math.max(LAG_FLOOR_S, update.liveEdge - position) : LAG_FLOOR_S;
    const lagS = sameLoad && seeked ? prevLag : measured;
    set({ state: update, anchor: sameLoad ? prevAnchor : anchorFor(update, nowMs), lagS, seeked });
  },
  noteSeek: () => set({ seeked: true }),
}));
