import type { StoredProgram } from '../db';

/** What a guide row shows under its channel name: the show on now and how far along it is. */
export interface OnNow {
  program: StoredProgram;
  /** 0-100: how much of the show has aired */
  pct: number;
}

/** null when the show isn't on at `now` (or has no length): the cell then shows just the name. */
export function onNow(program: StoredProgram | null | undefined, now: Date): OnNow | null {
  if (!program) return null;
  const start = program.start.getTime();
  const end = program.end.getTime();
  const t = now.getTime();
  if (!(end > start) || t < start || t >= end) return null;
  return { program, pct: ((t - start) / (end - start)) * 100 };
}
