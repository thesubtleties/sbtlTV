/** How the guide says times: clock times, days, time left and time until (search results and the hover card). */
export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Whole days from `now` to `ms`, by the local calendar (0 today, 1 tomorrow, -1 yesterday) */
export function daysFrom(ms: number, now: number): number {
  return Math.round((new Date(ms).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86400000);
}

export function dayLabel(ms: number, now: number): string {
  const days = daysFrom(ms, now);
  return days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : new Date(ms).toLocaleDateString([], { weekday: 'long' });
}

const span = (minutes: number) => (minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`);

export function timeLeft(endMs: number, now: number): string {
  return `${span(Math.max(1, Math.round((endMs - now) / 60000)))} left`;
}

/** "in 25m", "in 1h 5m" */
export function startsIn(startMs: number, now: number): string {
  return `in ${span(Math.max(1, Math.round((startMs - now) / 60000)))}`;
}

/** A show's length: "30m", "1h 30m", "2h" */
export function durationLabel(startMs: number, endMs: number): string {
  const minutes = Math.round((endMs - startMs) / 60000);
  return minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60}h` : span(minutes);
}

/**
 * A show's times, a shared AM/PM said once: "11:05 – 11:35 PM", "11:35 PM – 12:05 AM", "21:00 – 22:30" (24-hour and
 * marker-first locales have no trailing marker to share, so both times are kept whole).
 */
export function clockRange(startMs: number, endMs: number): string {
  const a = clock(startMs);
  const b = clock(endMs);
  const suffix = (t: string) => t.match(/[\s ]?[^\d\s :.]+$/u)?.[0] ?? '';
  const sa = suffix(a);
  return sa && sa === suffix(b) && endMs - startMs < 12 * 3_600_000 ? `${a.slice(0, -sa.length)} – ${b}` : `${a} – ${b}`;
}
