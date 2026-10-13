/**
 * Subtitle state for the current stream. Like playbackStore, kept out of App
 * state so track updates re-render only the CC control.
 *
 * Everything is tied to a load: main tags its track updates with the load's
 * generation, App binds the generation mpv-load returned (with what it is:
 * live or vod, and any saved delay), and every call back to main carries it,
 * so nothing decided for one stream can land on the next. Updates that arrive
 * before App binds their load wait for it.
 *
 * Live captions are TV-style: the CC track is selected as the channel starts
 * and the button only shows or hides it, so the decoder is already in step
 * when captions are turned on (main checks its first lines for station-data
 * junk, see CaptionCheck). Movies and episodes only offer the file's own
 * subtitle tracks; their embedded broadcast captions are not trustworthy.
 */
import { create } from 'zustand';
import type { CcState, SubtitleTrack, SubtitleTracksUpdate } from '../types/electron';
import { pickSubtitleTrack, stepDelay, type SubtitleKind } from '../services/subtitleLogic';
import { debugLog } from '../utils/debugLog';

/** A saved delay waiting for the file's duration to confirm it is the same file. */
export interface PendingDelay { delay: number; duration: number }

interface SubtitleData {
  generation: number;
  kind: SubtitleKind | null;
  tracks: SubtitleTrack[];
  selectedId: number | null;
  /** Live: captions shown (the CC track stays selected either way) */
  visible: boolean;
  ccState: CcState | null;
  /** other-language: the only caption language the channel gave */
  ccLanguage: 'en' | 'es' | 'fr' | null;
  delay: number;
  /** False until a saved delay has been restored or rejected; progress saves keep the stored one meanwhile */
  delayResolved: boolean;
  pendingDelay: PendingDelay | null;
  /** The last delay change the user made, with its load, for App to save */
  userDelayEdit: { seq: number; generation: number; delay: number } | null;
  /** This session's on/off per kind; null = follow the setting's default */
  sessionOn: Record<SubtitleKind, boolean | null>;
  /** A track update for a load App has not bound yet */
  waiting: SubtitleTracksUpdate | null;
}

interface SubtitleActions {
  bindLoad: (generation: number, kind: SubtitleKind, defaultOn: boolean, locale: string, pendingDelay: PendingDelay | null) => void;
  /** Main reloaded the same stream (stall recovery): follow it to the new load, keeping choices and delay */
  rebindLoad: (generation: number, defaultOn: boolean, locale: string) => void;
  receiveTracks: (update: SubtitleTracksUpdate, defaultOn: boolean, locale: string) => void;
  receiveCcState: (update: { generation: number; state: CcState; language: 'en' | 'es' | 'fr' | null }) => void;
  toggle: (locale: string) => void;
  selectTrack: (id: number | null) => void;
  /** The subtitle language setting changed: a movie or episode with subtitles on switches to that language's track */
  repickVodTrack: (locale: string) => void;
  nudgeDelay: (delta: number) => void;
  setDelay: (seconds: number) => void;
  clear: () => void;
}

/** Saved delays match the file when the durations agree within this many seconds. */
const DURATION_TOLERANCE_S = 5;

export function initialSubtitleState(): SubtitleData {
  return {
    generation: -1, kind: null, tracks: [], selectedId: null, visible: false, ccState: null, ccLanguage: null,
    delay: 0, delayResolved: true, pendingDelay: null, userDelayEdit: null,
    sessionOn: { live: null, vod: null }, waiting: null,
  };
}

function report(what: string) {
  return (err: unknown) => debugLog(`subtitle ${what} failed: ${err}`, 'subtitles');
}

export const useSubtitleStore = create<SubtitleData & SubtitleActions>((set, get) => {
  const send = {
    track: (id: number | null, visible: boolean) => window.subtitles?.setTrack(get().generation, id, visible).catch(report('setTrack')),
    visible: (visible: boolean) => window.subtitles?.setVisible(get().generation, visible).catch(report('setVisible')),
    delay: (seconds: number) => window.subtitles?.setDelay(get().generation, seconds).catch(report('setDelay')),
  };

  function apply(update: SubtitleTracksUpdate, defaultOn: boolean, locale: string) {
    const { kind, selectedId, sessionOn, pendingDelay, delayResolved } = get();
    if (!kind) return;
    const wanted = sessionOn[kind] ?? defaultOn;
    const tracks = kind === 'vod' ? update.tracks.filter((t) => !t.isCc) : update.tracks;
    set({ tracks });

    if (kind === 'live') {
      const cc = tracks.find((t) => t.isCc) ?? tracks[0];
      if (cc && selectedId !== cc.id) {
        set({ selectedId: cc.id, visible: wanted });
        send.track(cc.id, wanted);
      }
    } else if (selectedId === null || !tracks.some((t) => t.id === selectedId)) {
      const id = wanted ? pickSubtitleTrack(tracks, 'vod', locale) : null;
      if (id !== selectedId) {
        set({ selectedId: id });
        if (id !== null) send.track(id, true);
      }
    }

    if (!delayResolved && update.duration > 0) {
      const matches = pendingDelay !== null && Math.abs(pendingDelay.duration - update.duration) <= DURATION_TOLERANCE_S;
      set({ delayResolved: true, pendingDelay: null });
      if (matches) {
        set({ delay: pendingDelay.delay });
        send.delay(pendingDelay.delay);
      }
    }
  }

  function changeDelay(seconds: number) {
    const delay = stepDelay(seconds, 0);
    const prev = get().userDelayEdit;
    set({ delay, delayResolved: true, pendingDelay: null, userDelayEdit: { seq: (prev?.seq ?? 0) + 1, generation: get().generation, delay } });
    send.delay(delay);
  }

  return {
    ...initialSubtitleState(),

    bindLoad: (generation, kind, defaultOn, locale, pendingDelay) => {
      const { waiting } = get();
      set({
        generation, kind, tracks: [], selectedId: null, visible: false, ccState: null, ccLanguage: null, delay: 0,
        delayResolved: pendingDelay === null, pendingDelay, waiting: null,
      });
      if (waiting?.generation === generation) apply(waiting, defaultOn, locale);
    },

    rebindLoad: (generation, defaultOn, locale) => {
      const { waiting, kind, delay } = get();
      if (!kind) return;
      set({ generation, tracks: [], selectedId: null, visible: false, ccState: null, ccLanguage: null, waiting: null });
      if (delay !== 0) send.delay(delay);  // main reset sub-delay with the reload
      if (waiting?.generation === generation) apply(waiting, defaultOn, locale);
    },

    receiveTracks: (update, defaultOn, locale) => {
      const { generation } = get();
      if (update.generation > generation) set({ waiting: update });
      else if (update.generation === generation) apply(update, defaultOn, locale);
    },

    receiveCcState: ({ generation, state, language }) => {
      if (generation === get().generation) set({ ccState: state, ccLanguage: language });
    },

    toggle: (locale) => {
      const { kind, tracks, selectedId, visible, ccState, sessionOn } = get();
      if (!kind || tracks.length === 0) return;
      if (kind === 'live') {
        if (ccState === 'unreadable' || selectedId === null) return;
        set({ visible: !visible, sessionOn: { ...sessionOn, live: !visible } });
        send.visible(!visible);
        return;
      }
      const id = selectedId !== null ? null : pickSubtitleTrack(tracks, 'vod', locale);
      set({ selectedId: id, sessionOn: { ...sessionOn, vod: id !== null } });
      send.track(id, true);
    },

    selectTrack: (id) => {
      const { kind, sessionOn, ccState } = get();
      if (!kind) return;
      if (kind === 'live') {
        if (ccState === 'unreadable') return;
        set({ visible: id !== null, sessionOn: { ...sessionOn, live: id !== null } });
        send.visible(id !== null);
        return;
      }
      set({ selectedId: id, sessionOn: { ...sessionOn, vod: id !== null } });
      send.track(id, true);
    },

    repickVodTrack: (locale) => {
      const { kind, tracks, selectedId } = get();
      if (kind !== 'vod' || selectedId === null) return;
      const id = pickSubtitleTrack(tracks, 'vod', locale);
      if (id === null || id === selectedId) return;
      set({ selectedId: id });
      send.track(id, true);
    },

    nudgeDelay: (delta) => changeDelay(get().delay + delta),
    setDelay: (seconds) => changeDelay(seconds),

    clear: () => set({ kind: null, tracks: [], selectedId: null, visible: false, ccState: null, ccLanguage: null, delay: 0, delayResolved: true, pendingDelay: null }),
  };
});
