// User-timing measures for the Linux debug trace (blink.user_timing). Off
// unless VideoCanvas turns them on with debug logging, so normal playback pays
// only a boolean check.
let enabled = false;

export function setPerfMarksEnabled(value: boolean): void {
  enabled = value;
}

/** Start time for perfMeasure, or -1 when marks are off. */
export function perfStart(): number {
  return enabled ? performance.now() : -1;
}

export function perfMeasure(name: string, start: number): void {
  if (start < 0 || !enabled) return;
  try {
    performance.measure(name, { start, end: performance.now() });
  } catch { /* measure is diagnostics only */ }
}
