export type FirstRunMode = 'setup' | 'offer-sync' | null;
export const STEPS = ['welcome', 'source', 'look', 'tmdb', 'subtitles', 'sync', 'done'] as const;
export type StepId = (typeof STEPS)[number];

/** What the first-run panel shows now: the setup (no sources, never finished), the one-time sync offer after a received setup, or nothing. */
export function firstRunMode(s: { settingsLoaded: boolean; sourcesLoaded: boolean; sourceCount: number; marker: 'offer-sync' | 'done' | undefined }): FirstRunMode {
  if (!s.settingsLoaded || !s.sourcesLoaded || s.marker === 'done') return null;
  // The sync offer follows a received setup; with no source (the apply failed, or the setup had none) it's the setup again
  if (s.marker === 'offer-sync') return s.sourceCount > 0 ? 'offer-sync' : 'setup';
  return s.sourceCount === 0 ? 'setup' : null;
}

const OPTIONAL = new Set<StepId>(['tmdb', 'subtitles', 'sync']);
export const isOptional = (step: StepId): boolean => OPTIONAL.has(step);
export const nextStep = (step: StepId): StepId => STEPS[Math.min(STEPS.length - 1, STEPS.indexOf(step) + 1)];
export const prevStep = (step: StepId): StepId => STEPS[Math.max(0, STEPS.indexOf(step) - 1)];

/** A received setup restarts the app; a received join (Sync carries no sources) still needs a TV source. */
export const afterReceive = (kind: 'setup' | 'join'): 'restart' | StepId => (kind === 'setup' ? 'restart' : 'source');

type ImportStep = 'idle' | 'passphrase' | 'preview' | 'join' | 'applying' | 'failed';

/** The receive view goes back once something received was declined or dismissed (back to idle from a preview, a join or a failure). */
export const receiveViewCloses = (prev: ImportStep, next: ImportStep): boolean =>
  next === 'idle' && (prev === 'preview' || prev === 'join' || prev === 'failed' || prev === 'passphrase');

/** Where the setup goes after joining a sync: the source if there's none yet, else on with the setup; from the sync step, the end. */
export const stepAfterJoin = (from: StepId, hasSource: boolean): StepId =>
  from === 'sync' ? 'done' : hasSource ? 'look' : (afterReceive('join') as StepId);

/** Tab from the last control (or Shift+Tab from the first) wraps inside the panel; null lets the browser move focus. */
export function wrapFocus(count: number, current: number, back: boolean): number | null {
  if (count === 0) return null;
  if (current < 0) return back ? count - 1 : 0;
  if (!back && current === count - 1) return 0;
  if (back && current === 0) return count - 1;
  return null;
}
