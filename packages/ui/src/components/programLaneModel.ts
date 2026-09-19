// Pure helpers for the guide's program lane: the placeholders a row shows
// before its programs are read, how the lane decides what to do when they
// arrive, and how placeholders hand off to the real blocks. Timings were
// tuned by eye on a prototype; these constants are the source of truth.

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
// MORPH_LEAD_MS and takes MORPH_MS to land. A show that already ended starts
// its title fade at MORPH_LEAD_MS instead (see planMorph). The lane hands
// over to the real blocks once both have finished.
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
  onAir: boolean;
  ended: boolean; // finished before now; its title only starts fading in as its block begins to land
}

export interface MorphPlan<T extends MorphTarget> {
  become: { placeholder: number; program: T; titled: boolean }[];
  spare: number[];
  extra: T[];
}

function overlap(a: { left: number; width: number }, b: { left: number; width: number }): number {
  return Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left));
}

// Each program takes the free placeholder it overlaps most, the on-air program
// choosing first so "now" lands where the eye already is. A program that
// overlaps no free placeholder fades in once the others have landed.
// Placeholders nothing claimed fade away. Programs that already ended do not
// show a title until they begin to land, so a finished show never announces
// itself and then gets covered by the on-air block.
export function planMorph<T extends MorphTarget>(
  placeholders: { left: number; width: number }[],
  programs: T[]
): MorphPlan<T> {
  const free = new Set(placeholders.map((_, i) => i));
  const become: { placeholder: number; program: T; titled: boolean }[] = [];
  const extra: T[] = [];
  const ordered = [...programs].sort((a, b) => Number(b.onAir) - Number(a.onAir));
  for (const program of ordered) {
    let best = -1;
    let bestOverlap = 0;
    for (const i of free) {
      const o = overlap(placeholders[i], program);
      if (o > bestOverlap) {
        best = i;
        bestOverlap = o;
      }
    }
    if (best === -1) {
      extra.push(program);
      continue;
    }
    free.delete(best);
    become.push({ placeholder: best, program, titled: !program.ended });
  }
  become.sort((a, b) => a.placeholder - b.placeholder);
  return { become, spare: [...free].sort((a, b) => a - b), extra };
}

// What the lane should do when its programs prop changes. Kept pure so the
// transitions are testable; ProgramLane owns the timers and the DOM.
export interface LaneInput {
  phase: 'loading' | 'morph' | 'ready';
  loadingSinceMs: number;   // meaningful when phase is 'loading'
  hadPrograms: boolean;     // the previous programs prop was a non-empty array
  programs: 'unread' | 'empty' | 'some';
  nowMs: number;
  reducedMotion: boolean;
  morphEnabled: boolean;
}

export type LaneDecision = 'stay' | 'load' | 'ready' | 'fade-in' | 'morph';

export function decideLane(input: LaneInput): LaneDecision {
  if (input.programs === 'unread') return input.phase === 'loading' ? 'stay' : 'load';
  if (input.programs === 'empty') return input.phase === 'ready' ? 'stay' : 'ready';
  if (input.reducedMotion) return input.phase === 'ready' ? 'stay' : 'ready';
  if (input.phase === 'ready') return input.hadPrograms ? 'stay' : 'fade-in';
  if (input.phase === 'morph') return 'fade-in';
  if (!input.morphEnabled || resolveKind(input.loadingSinceMs, input.nowMs) === 'quick') return 'fade-in';
  return 'morph';
}
