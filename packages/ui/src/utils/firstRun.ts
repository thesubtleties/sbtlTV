export type FirstRunMode = 'setup' | 'offer-sync' | null;
export const STEPS = ['welcome', 'source', 'look', 'tmdb', 'subtitles', 'sync', 'done'] as const;
export type StepId = (typeof STEPS)[number];

/** What the first-run panel shows now: the setup (no sources, never finished), the one-time sync offer after a received setup, or nothing. */
export function firstRunMode(s: { settingsLoaded: boolean; sourcesLoaded: boolean; sourceCount: number; marker: 'offer-sync' | 'done' | undefined }): FirstRunMode {
  if (!s.settingsLoaded || !s.sourcesLoaded || s.marker === 'done') return null;
  if (s.marker === 'offer-sync') return 'offer-sync';
  return s.sourceCount === 0 ? 'setup' : null;
}

const OPTIONAL = new Set<StepId>(['tmdb', 'subtitles', 'sync']);
export const isOptional = (step: StepId): boolean => OPTIONAL.has(step);
export const nextStep = (step: StepId): StepId => STEPS[Math.min(STEPS.length - 1, STEPS.indexOf(step) + 1)];
export const prevStep = (step: StepId): StepId => STEPS[Math.max(0, STEPS.indexOf(step) - 1)];

/** A received setup restarts the app; a received join (Sync carries no sources) still needs a TV source. */
export const afterReceive = (kind: 'setup' | 'join'): 'restart' | StepId => (kind === 'setup' ? 'restart' : 'source');
