/**
 * Subtitle state for the current stream. Like playbackStore, kept out of App
 * state so track updates re-render only the CC control. Actions send the
 * choice to mpv through window.subtitles; main resets track and delay on
 * every load, so a new stream always starts from "off, 0s" in mpv too.
 */
import { create } from 'zustand';
import type { SubtitleTrack } from '../types/electron';
import { pickSubtitleTrack, stepDelay, type SubtitleKind } from '../services/subtitleLogic';
import { debugLog } from '../utils/debugLog';

interface SubtitleState {
  kind: SubtitleKind | null;
  generation: number;
  tracks: SubtitleTrack[];
  selectedId: number | null;
  delay: number;
  /** This session's on/off per kind; null = follow the setting's default */
  sessionOn: Record<SubtitleKind, boolean | null>;
  startStream: (kind: SubtitleKind, generation: number, tracks: SubtitleTrack[], defaultOn: boolean, locale: string) => void;
  updateTracks: (tracks: SubtitleTrack[], defaultOn: boolean, locale: string) => void;
  toggle: (locale: string) => void;
  selectTrack: (id: number | null) => void;
  nudgeDelay: (delta: number) => void;
  setDelay: (seconds: number) => void;
  clear: () => void;
}

function sendTrack(id: number | null): void {
  window.subtitles?.setTrack(id).catch((err) => debugLog(`subtitle setTrack failed: ${err}`, 'subtitles'));
}

function sendDelay(seconds: number): void {
  window.subtitles?.setDelay(seconds).catch((err) => debugLog(`subtitle setDelay failed: ${err}`, 'subtitles'));
}

export const useSubtitleStore = create<SubtitleState>((set, get) => {
  const wanted = (kind: SubtitleKind, defaultOn: boolean) => get().sessionOn[kind] ?? defaultOn;

  return {
    kind: null,
    generation: -1,
    tracks: [],
    selectedId: null,
    delay: 0,
    sessionOn: { live: null, vod: null },

    startStream: (kind, generation, tracks, defaultOn, locale) => {
      const id = wanted(kind, defaultOn) ? pickSubtitleTrack(tracks, kind, locale) : null;
      set({ kind, generation, tracks, selectedId: id, delay: 0 });
      if (id !== null) sendTrack(id);
    },

    updateTracks: (tracks, defaultOn, locale) => {
      const { kind, selectedId } = get();
      if (!kind) return;
      const stillThere = selectedId !== null && tracks.some(t => t.id === selectedId);
      let id = stillThere ? selectedId : null;
      if (id === null && wanted(kind, defaultOn)) id = pickSubtitleTrack(tracks, kind, locale);
      set({ tracks, selectedId: id });
      if (id !== selectedId) sendTrack(id);
    },

    toggle: (locale) => {
      const { kind, tracks, selectedId, sessionOn } = get();
      if (!kind || tracks.length === 0) return;
      if (selectedId !== null) {
        set({ selectedId: null, sessionOn: { ...sessionOn, [kind]: false } });
        sendTrack(null);
        return;
      }
      const id = pickSubtitleTrack(tracks, kind, locale);
      set({ selectedId: id, sessionOn: { ...sessionOn, [kind]: true } });
      sendTrack(id);
    },

    selectTrack: (id) => {
      const { kind, sessionOn } = get();
      if (!kind) return;
      set({ selectedId: id, sessionOn: { ...sessionOn, [kind]: id !== null } });
      sendTrack(id);
    },

    nudgeDelay: (delta) => get().setDelay(stepDelay(get().delay, delta)),

    setDelay: (seconds) => {
      const delay = stepDelay(seconds, 0);
      set({ delay });
      sendDelay(delay);
    },

    clear: () => set({ kind: null, tracks: [], selectedId: null, delay: 0 }),
  };
});
