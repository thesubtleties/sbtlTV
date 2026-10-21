/**
 * Subtitle state for the current stream. Like playbackStore, kept out of App
 * state so track updates re-render only the CC control.
 *
 * Everything is tied to a load: main announces each load it starts
 * (media-loaded) and tags its track updates with the load's generation, App
 * binds the announced generation (with what it is: live or vod, and any saved
 * delay), and every call back to main carries it, so nothing decided for one
 * stream can land on the next. Updates that arrive before App binds their load
 * wait for it; an announcement older than the bound load is ignored.
 *
 * Live captions are TV-style: the CC track is selected as the channel starts
 * and the button only shows or hides it, so the decoder is already in step
 * when captions are turned on (main checks its first lines for station-data
 * junk, see CaptionCheck). Movies and episodes only offer the file's own
 * subtitle tracks; their embedded broadcast captions are not trustworthy.
 */
import { create } from 'zustand';
import type { CcState, SubdlTitle, SubtitleTrack, SubtitleTracksUpdate } from '../types/electron';
import { decideVodSubtitle, localeSubtitleTrack, pickSubtitleTrack, stepDelay, type SubtitleKind } from '../services/subtitleLogic';
import { debugLog } from '../utils/debugLog';

/**
 * A saved subtitle choice waiting for the file's duration to confirm it is the
 * same file: the delay, and with SubDL the file and its speed.
 */
export interface PendingDelay { delay: number; duration: number; speed?: number; subdlId?: string | null; ai?: boolean }

/** SubDL for this load: set when a key is saved and the title has a TMDB match. */
export interface SubdlLoadInfo { title: SubdlTitle; language: string; languageIso: string[]; preferSdh: boolean }
/** What the CC menu says about SubDL for this load */
export type SubdlStatus = 'quota' | 'not-found' | 'auth' | 'cut' | { fps: { from: number; to: number } };
/** A subtitle change the user made, with its load, for App to save */
export interface SubtitleEdit { seq: number; generation: number; delay: number; speed: number; subdlId: string | null; ai: boolean }

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
  /** sub-speed (1 = as the file says); set by a frame-rate fix or a two-line sync */
  speed: number;
  /** The last subtitle change the user made (delay, speed, SubDL file), with its load, for App to save */
  userSubtitleEdit: SubtitleEdit | null;
  /** SubDL for this load, or null (no key, no TMDB match, live) */
  subdl: SubdlLoadInfo | null;
  /** SubDL tracks of this load by track id */
  downloaded: Record<number, { nId: string; ai: boolean; language: string }>;
  subdlBusy: boolean;
  subdlStatus: SubdlStatus | null;
  /** The automatic SubDL attempt for this load has started (once per load) */
  subdlTried: boolean;
  /** A track list with the file's duration has arrived: the file's own tracks are known (the one announced at load start is empty) */
  listReady: boolean;
  /** The locale bound with the load, for the fallback track */
  locale: string;
  pickerOpen: boolean;
  syncOpen: boolean;
  /** This session's on/off per kind; null = follow the setting's default */
  sessionOn: Record<SubtitleKind, boolean | null>;
  /** A track update for a load App has not bound yet */
  waiting: SubtitleTracksUpdate | null;
}

interface SubtitleActions {
  bindLoad: (generation: number, kind: SubtitleKind, defaultOn: boolean, locale: string, pendingDelay: PendingDelay | null, subdl?: SubdlLoadInfo | null) => void;
  /** Main reloaded the same stream (stall recovery): follow it to the new load, keeping the on/off choice and the delay */
  rebindLoad: (generation: number, defaultOn: boolean, locale: string) => void;
  receiveTracks: (update: SubtitleTracksUpdate, defaultOn: boolean, locale: string) => void;
  receiveCcState: (update: { generation: number; state: CcState; language: 'en' | 'es' | 'fr' | null }) => void;
  toggle: (locale: string) => void;
  selectTrack: (id: number | null) => void;
  /** The subtitle language setting changed: a movie or episode with subtitles on switches to that language's track */
  repickVodTrack: (locale: string) => void;
  nudgeDelay: (delta: number) => void;
  setDelay: (seconds: number) => void;
  /** Subtitle speed from Sync (a user change) */
  setSpeed: (speed: number) => void;
  /** Load a SubDL file (or 'auto': the best match). userPick: chosen in the picker, saved for the title. */
  /** language: the picker's choice (defaults to the load's language), shown as the track's name */
  loadSubdl: (nId: string, userPick?: boolean, language?: string) => Promise<void>;
  openPicker: (open: boolean) => void;
  openSync: (open: boolean) => void;
  clear: () => void;
}

/** Saved delays match the file when the durations agree within this many seconds. */
const DURATION_TOLERANCE_S = 5;

export function initialSubtitleState(): SubtitleData {
  return {
    generation: -1, kind: null, tracks: [], selectedId: null, visible: false, ccState: null, ccLanguage: null,
    delay: 0, delayResolved: true, pendingDelay: null, speed: 1, userSubtitleEdit: null,
    sessionOn: { live: null, vod: null }, waiting: null,
    subdl: null, downloaded: {}, subdlBusy: false, subdlStatus: null, subdlTried: false, listReady: false, locale: 'en',
    pickerOpen: false, syncOpen: false,
  };
}

/** Main answers stale or invalid calls with { error }; a throw is a broken IPC. Both go to the debug log. */
function report(what: string, call: Promise<{ error?: string }> | undefined) {
  call?.then(
    (result) => { if (result?.error) debugLog(`subtitle ${what}: ${result.error}`, 'subtitles'); },
    (err: unknown) => debugLog(`subtitle ${what} failed: ${err}`, 'subtitles'),
  );
}

export const useSubtitleStore = create<SubtitleData & SubtitleActions>((set, get) => {
  const send = {
    track: (id: number | null, visible: boolean) => report('setTrack', window.subtitles?.setTrack(get().generation, id, visible)),
    visible: (visible: boolean) => report('setVisible', window.subtitles?.setVisible(get().generation, visible)),
    delay: (seconds: number) => report('setDelay', window.subtitles?.setDelay(get().generation, seconds)),
    speed: (speed: number) => report('setSpeed', window.subdl?.setSpeed(get().generation, speed)),
  };

  /** The SubDL file of the selected track, for saving. */
  function currentChoice(): { subdlId: string | null; ai: boolean } {
    const { selectedId, downloaded } = get();
    const d = selectedId !== null ? downloaded[selectedId] : undefined;
    return { subdlId: d?.nId ?? null, ai: d?.ai ?? false };
  }

  function recordEdit() {
    const { userSubtitleEdit: prev, generation, delay, speed } = get();
    set({ userSubtitleEdit: { seq: (prev?.seq ?? 0) + 1, generation, delay, speed, ...currentChoice() } });
  }

  /** Movies and episodes: what to show when subtitles turn on (SubDL rule with a key, else as before). */
  function chooseVod(tracks: SubtitleTrack[], locale: string): void {
    const { subdl, pendingDelay, subdlTried } = get();
    if (!subdl) {
      const id = pickSubtitleTrack(tracks, 'vod', locale);
      set({ selectedId: id });
      if (id !== null) send.track(id, true);
      return;
    }
    const saved = pendingDelay?.subdlId ? { subdlId: pendingDelay.subdlId, ai: pendingDelay.ai ?? false, delay: pendingDelay.delay, speed: pendingDelay.speed ?? 1, duration: pendingDelay.duration } : null;
    const decision = decideVodSubtitle(tracks, { languageIso: subdl.languageIso, preferSdh: subdl.preferSdh, subdl: true, saved: subdlTried ? null : saved });
    if (decision.kind === 'track') {
      set({ selectedId: decision.id });
      send.track(decision.id, true);
    } else if (decision.kind === 'subdl' && !subdlTried && get().listReady) {
      set({ subdlTried: true });
      void loadSubdl(decision.nId, false, subdl.language);
    }
  }

  async function loadSubdl(nId: string, userPick: boolean, language?: string): Promise<void> {
    const { generation, subdl } = get();
    if (!subdl || !window.subdl) return;
    set({ subdlBusy: true, subdlStatus: null });
    const result = await window.subdl.load(generation, subdl.title, nId, subdl.language, 0).catch(() => ({ error: 'network' as const }));
    if (get().generation !== generation) return;
    set({ subdlBusy: false });
    if (result.error || result.trackId === undefined || !result.nId) {
      const status = result.error === 'quota' || result.error === 'not-found' || result.error === 'auth' ? result.error : null;
      set({ subdlStatus: status });
      debugLog(`SubDL: ${result.error ?? 'no track'}`, 'subtitles');
      // Nothing showing yet: fall back to the file's own track, as without SubDL
      const { selectedId, tracks, locale } = get();
      if (!userPick && selectedId === null) {
        const id = pickSubtitleTrack(tracks.filter((t) => !t.external), 'vod', locale);
        set({ selectedId: id });
        if (id !== null) send.track(id, true);
      }
      return;
    }
    const { pendingDelay, downloaded } = get();
    const savedHere = pendingDelay?.subdlId === result.nId;
    const ai = result.ai === true || (savedHere && pendingDelay?.ai === true);
    set({ downloaded: { ...downloaded, [result.trackId]: { nId: result.nId, ai, language: language ?? subdl.language } }, selectedId: result.trackId, sessionOn: { ...get().sessionOn, vod: true } });
    send.track(result.trackId, true);
    if (savedHere && pendingDelay) {
      // The saved choice: its delay and speed, no new timing guess
      set({ delay: pendingDelay.delay, speed: pendingDelay.speed ?? 1, delayResolved: true, pendingDelay: null });
      if (pendingDelay.delay !== 0) send.delay(pendingDelay.delay);
      if ((pendingDelay.speed ?? 1) !== 1) send.speed(pendingDelay.speed!);
    } else if (result.timing?.speed) {
      set({ speed: result.timing.speed, subdlStatus: result.timing.fps ? { fps: result.timing.fps } : null });
      send.speed(result.timing.speed);
    } else if (result.timing?.cutMismatch) {
      set({ subdlStatus: 'cut' });
    }
    if (userPick) recordEdit();
  }

  function apply(update: SubtitleTracksUpdate, defaultOn: boolean, locale: string) {
    const { kind, selectedId, sessionOn, pendingDelay, delayResolved } = get();
    if (!kind) return;
    const wanted = sessionOn[kind] ?? defaultOn;
    const tracks = kind === 'vod' ? update.tracks.filter((t) => !t.isCc) : update.tracks;
    set({ tracks, ...(update.duration > 0 && { listReady: true }) });

    if (kind === 'live') {
      const cc = tracks.find((t) => t.isCc) ?? tracks[0];
      if (cc && selectedId !== cc.id) {
        set({ selectedId: cc.id, visible: wanted });
        send.track(cc.id, wanted);
      }
    } else if (selectedId === null || !tracks.some((t) => t.id === selectedId)) {
      if (wanted) chooseVod(tracks, locale);
      else if (selectedId !== null) set({ selectedId: null });
    }

    if (!delayResolved && update.duration > 0) {
      const matches = pendingDelay !== null && Math.abs(pendingDelay.duration - update.duration) <= DURATION_TOLERANCE_S;
      set({ delayResolved: true, pendingDelay: null });
      if (matches && !pendingDelay.subdlId) {
        set({ delay: pendingDelay.delay, speed: pendingDelay.speed ?? 1 });
        send.delay(pendingDelay.delay);
        if ((pendingDelay.speed ?? 1) !== 1) send.speed(pendingDelay.speed!);
      } else if (matches) {
        set({ pendingDelay });  // kept for the SubDL load, which applies it with the file
      }
    }
  }

  function changeDelay(seconds: number) {
    const delay = stepDelay(seconds, 0);
    set({ delay, delayResolved: true, pendingDelay: null });
    send.delay(delay);
    recordEdit();
  }

  return {
    ...initialSubtitleState(),

    bindLoad: (generation, kind, defaultOn, locale, pendingDelay, subdl = null) => {
      const { waiting } = get();
      if (generation < get().generation) return;
      set({
        generation, kind, tracks: [], selectedId: null, visible: false, ccState: null, ccLanguage: null, delay: 0, speed: 1,
        delayResolved: pendingDelay === null, pendingDelay, waiting: null,
        subdl: kind === 'vod' ? subdl : null, downloaded: {}, subdlBusy: false, subdlStatus: null, subdlTried: false, listReady: false, locale,
        pickerOpen: false, syncOpen: false,
      });
      if (waiting?.generation === generation) apply(waiting, defaultOn, locale);
    },

    rebindLoad: (generation, defaultOn, locale) => {
      const { waiting, kind, delay, speed } = get();
      if (!kind || generation < get().generation) return;
      // A reload drops sub-added files: SubDL loads again (from the cache) for the new load
      set({ generation, tracks: [], selectedId: null, visible: false, ccState: null, ccLanguage: null, waiting: null, downloaded: {}, subdlTried: false, subdlBusy: false, listReady: false });
      if (delay !== 0) send.delay(delay);  // main reset sub-delay with the reload
      if (speed !== 1) send.speed(speed);
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
      const { kind, tracks, selectedId, visible, ccState, sessionOn, subdl } = get();
      if (!kind || (tracks.length === 0 && !(kind === 'vod' && subdl))) return;
      if (kind === 'live') {
        if (ccState === 'unreadable' || selectedId === null) return;
        set({ visible: !visible, sessionOn: { ...sessionOn, live: !visible } });
        send.visible(!visible);
        return;
      }
      if (selectedId !== null) {
        set({ selectedId: null, sessionOn: { ...sessionOn, vod: false } });
        send.track(null, true);
        return;
      }
      set({ sessionOn: { ...sessionOn, vod: true } });
      chooseVod(tracks, locale);
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
      recordEdit();
    },

    repickVodTrack: (locale) => {
      const { kind, tracks, selectedId } = get();
      if (kind !== 'vod' || selectedId === null) return;
      const id = localeSubtitleTrack(tracks, locale);  // none in that language: keep the current one
      if (id === null || id === selectedId) return;
      set({ selectedId: id });
      send.track(id, true);
    },

    nudgeDelay: (delta) => changeDelay(get().delay + delta),
    setDelay: (seconds) => changeDelay(seconds),
    setSpeed: (speed) => {
      set({ speed });
      send.speed(speed);
      recordEdit();
    },
    loadSubdl: (nId, userPick = false, language) => loadSubdl(nId, userPick, language),
    openPicker: (open) => set({ pickerOpen: open, syncOpen: open ? false : get().syncOpen }),
    openSync: (open) => set({ syncOpen: open, pickerOpen: open ? false : get().pickerOpen }),

    clear: () => set({
      kind: null, tracks: [], selectedId: null, visible: false, ccState: null, ccLanguage: null, delay: 0, delayResolved: true, pendingDelay: null,
      speed: 1, subdl: null, downloaded: {}, subdlBusy: false, subdlStatus: null, subdlTried: false, pickerOpen: false, syncOpen: false,
    }),
  };
});
