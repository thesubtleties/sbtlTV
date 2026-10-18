/**
 * Pure logic behind the playback keyboard shortcuts in App.tsx, kept out of
 * the component so it can be unit tested without a DOM.
 */

export interface PlaybackKeyState {
  position: number;
  duration: number;
  volume: number;
  /** App view: 'none' while just watching; 'guide', 'movies', 'series', 'settings' otherwise */
  activeView: string;
  categoriesOpen: boolean;
  /** Live with rewind on: the reachable range in stream seconds; null/absent otherwise */
  liveRange?: { start: number; end: number } | null;
}

/** mpv's default seek bindings: 5s sideways, 60s up and down. */
export const SEEK_KEY_DELTAS: Record<string, number> = {
  ArrowLeft: -5,
  ArrowRight: 5,
  ArrowUp: 60,
  ArrowDown: -60,
};

/**
 * Target position for a seek key, or null when the key should be left alone:
 * not a seek key, something other than the video is open (the guide uses
 * Left/Right for its timeline, the library views browse with arrows), or the
 * stream has no duration (live TV) and no rewind buffer to seek in.
 */
export function resolveSeek(key: string, state: PlaybackKeyState): number | null {
  const delta = SEEK_KEY_DELTAS[key];
  if (delta === undefined) return null;
  if (state.activeView !== 'none' || state.categoriesOpen) return null;
  if (state.liveRange) return Math.min(Math.max(state.liveRange.start, state.position + delta), state.liveRange.end);
  if (state.duration > 0) return Math.min(Math.max(0, state.position + delta), state.duration);
  return null;
}

/** End on live with rewind: the live edge; null otherwise. */
export function resolveLiveJump(key: string, state: PlaybackKeyState): number | null {
  if (key !== 'End' || state.activeView !== 'none' || state.categoriesOpen || !state.liveRange) return null;
  return state.liveRange.end;
}

/** Volume after a keyboard step, clamped to 0..100 and rounded. */
export function resolveVolumeStep(volume: number, delta: number): number {
  return Math.min(100, Math.max(0, Math.round(volume + delta)));
}
