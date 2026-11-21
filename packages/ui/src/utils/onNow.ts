/** What a guide row shows under its channel name: the show on now, how far along it is, and what's left. */
export interface OnNow {
  title: string;
  /** 0-100: how much of the show has aired */
  pct: number;
  /** Whole minutes until it ends (0 in its last minute) */
  minutesLeft: number;
}

const ms = (d: Date | string) => (d instanceof Date ? d.getTime() : new Date(d).getTime());

/** null when the show isn't on at `now` (or has no length): the cell then looks as it does without EPG. */
export function onNow(program: { title: string; start: Date | string; end: Date | string } | null | undefined, now: Date): OnNow | null {
  if (!program) return null;
  const start = ms(program.start);
  const end = ms(program.end);
  const t = now.getTime();
  if (!(end > start) || t < start || t >= end) return null;
  return {
    title: program.title,
    pct: ((t - start) / (end - start)) * 100,
    minutesLeft: Math.floor((end - t) / 60_000),
  };
}
