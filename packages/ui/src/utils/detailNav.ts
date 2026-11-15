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
 * Chromium may follow the mouse back button with a history popstate; a popstate this soon after the
 * mouse back is that same step, not a second one.
 */
export const MOUSE_BACK_ECHO_MS = 1000;

export function isMouseBackEcho(now: number, mouseBackAt: number, windowMs = MOUSE_BACK_ECHO_MS): boolean {
  return now - mouseBackAt < windowMs;
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
