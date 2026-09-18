// Pure helpers for the guide's program lane: the placeholders a row shows
// before its programs are read, and how those placeholders hand off to the
// real blocks. Timings are the ones chosen on the shimmer studies page.

// Placeholder widths as fractions of the lane, chosen by row so the columns
// of identical blanks are gone. Each pattern sums to 1.
const LOADING_PATTERNS = [
  [0.22, 0.34, 0.18, 0.26],
  [0.31, 0.19, 0.27, 0.23],
  [0.17, 0.29, 0.36, 0.18],
  [0.26, 0.24, 0.15, 0.35],
];

// Each block's edge wakes on its own period, starting partway through it.
const EDGE_PERIODS_MS = [1900, 2700, 1500, 2300];

// A row whose programs arrive this soon after it appeared skips the morph and
// simply fades in; the morph is for rows the user has actually seen waiting.
export const QUICK_RESOLVE_MS = 120;

// Title fades in over TITLE_FADE_MS; the block starts carrying it after
// MORPH_LEAD_MS and takes MORPH_MS to land. The lane hands over to the real
// blocks once both have finished.
export const TITLE_FADE_MS = 1400;
export const MORPH_LEAD_MS = 700;
export const MORPH_MS = 480;
export const MORPH_TOTAL_MS = Math.max(TITLE_FADE_MS, MORPH_LEAD_MS + MORPH_MS) + 60;

export interface LoadingBlock {
  left: number;
  width: number;
  durationMs: number;
  phaseMs: number; // negative: how far into its period the animation starts
}

export function loadingBlocks(rowIndex: number, laneWidth: number): LoadingBlock[] {
  const pattern = LOADING_PATTERNS[rowIndex % LOADING_PATTERNS.length];
  const blocks: LoadingBlock[] = [];
  let left = 0;
  for (let i = 0; i < pattern.length; i++) {
    const durationMs = EDGE_PERIODS_MS[(i + rowIndex) % EDGE_PERIODS_MS.length];
    const phaseMs = -((rowIndex * 370 + i * 530) % durationMs);
    const width = laneWidth * pattern[i];
    blocks.push({ left, width, durationMs, phaseMs });
    left += width;
  }
  return blocks;
}

export function resolveKind(loadingSinceMs: number, nowMs: number): 'quick' | 'morph' {
  return nowMs - loadingSinceMs < QUICK_RESOLVE_MS ? 'quick' : 'morph';
}

export interface MorphTarget {
  key: string;
  left: number;
  width: number;
}

export interface MorphPlan<T extends MorphTarget> {
  become: { placeholder: number; program: T }[];
  spare: number[];
  extra: T[];
}

// Placeholders take programs in order. Placeholders left over fade away;
// programs left over fade in once the morph has landed.
export function planMorph<T extends MorphTarget>(placeholderCount: number, programs: T[]): MorphPlan<T> {
  const become: { placeholder: number; program: T }[] = [];
  const spare: number[] = [];
  for (let i = 0; i < placeholderCount; i++) {
    if (i < programs.length) become.push({ placeholder: i, program: programs[i] });
    else spare.push(i);
  }
  return { become, spare, extra: programs.slice(placeholderCount) };
}
