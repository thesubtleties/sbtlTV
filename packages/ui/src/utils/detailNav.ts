/**
 * Which title a Movies/Series page has open, and the titles behind it (opened from More like this).
 * One value, so the open title and the trail can't disagree.
 *
 * - open: from the home page, a category, the hero or Continue Watching. Starts a fresh trail.
 * - openRelated: from More like this. The current title goes on the trail.
 * - back: one title back; with an empty trail, closes the detail (same as home).
 * - home: closes the detail and forgets the trail.
 */
export interface DetailNav<T> {
  current: T | null;
  trail: T[];
}

export type DetailNavAction<T> =
  | { type: 'open'; item: T }
  | { type: 'openRelated'; item: T }
  | { type: 'back' }
  | { type: 'home' };

/**
 * Keys that mean "one title back": Alt+Left, Cmd+[ (macOS), and a keyboard's Back key. Not while
 * typing: Alt+Left moves by word in a text field on macOS.
 */
export function isBackKey(e: Pick<KeyboardEvent, 'key' | 'altKey' | 'metaKey' | 'ctrlKey' | 'shiftKey'>, typing: boolean): boolean {
  if (e.key === 'BrowserBack') return true;
  if (typing) return false;
  if (e.key === 'ArrowLeft') return e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey;
  if (e.key === '[') return e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey;
  return false;
}

/** The key a series' remembered season is kept under (uiStore seriesSeasonMap). */
export function seriesSeasonKey(series: { tmdb_id?: number; series_id: string }): string {
  return series.tmdb_id?.toString() ?? series.series_id;
}

/** Keeps the trail from growing without bound on long More like this chains. */
export const MAX_TRAIL = 50;

export function detailNav<T>(state: DetailNav<T>, action: DetailNavAction<T>): DetailNav<T> {
  switch (action.type) {
    case 'open':
      return { current: action.item, trail: [] };
    case 'openRelated':
      if (!state.current) return { current: action.item, trail: [] };
      return { current: action.item, trail: [...state.trail, state.current].slice(-MAX_TRAIL) };
    case 'back':
      if (!state.trail.length) return { current: null, trail: [] };
      return { current: state.trail[state.trail.length - 1], trail: state.trail.slice(0, -1) };
    case 'home':
      return state.current === null && state.trail.length === 0 ? state : { current: null, trail: [] };
  }
}
