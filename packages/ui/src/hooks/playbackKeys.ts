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
 * stream has no duration (live TV).
 */
export function resolveSeek(key: string, state: PlaybackKeyState): number | null {
  const delta = SEEK_KEY_DELTAS[key];
  if (delta === undefined) return null;
  if (state.activeView !== 'none' || state.categoriesOpen || state.duration <= 0) return null;
  return Math.min(Math.max(0, state.position + delta), state.duration);
}

/** Volume after a keyboard step, clamped to 0..100 and rounded. */
export function resolveVolumeStep(volume: number, delta: number): number {
  return Math.min(100, Math.max(0, Math.round(volume + delta)));
}
