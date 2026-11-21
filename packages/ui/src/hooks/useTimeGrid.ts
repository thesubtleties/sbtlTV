import { useState, useEffect, useCallback, useMemo } from 'react';

export interface TimeGridState {
  // The current time, ticking on each minute (the clock, and what is on now)
  now: Date;
  // The left edge of the visible time window
  anchor: Date;
  // True when following the current time (the left edge is then the half hour now is in)
  isAtNow: boolean;
  // Number of hours visible (2-5)
  visibleHours: number;
  // Pixels per hour based on available width
  pixelsPerHour: number;
  // Start and end of visible window
  windowStart: Date;
  windowEnd: Date;
  // Start and end of data loading window (wider for preloading)
  loadStart: Date;
  loadEnd: Date;
}

export interface TimeGridActions {
  goBack: () => void;
  goForward: () => void;
  goToNow: () => void;
  goTo: (date: Date) => void;
}

// Clamp a value between min and max
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// The current minute (the guide's "now"; the left edge at now is its half hour)
function getNow(): Date {
  return new Date(minuteOf(Date.now()));
}

/** Time until just past the next minute (local minutes fall on whole UTC minutes). */
export function msUntilNextMinute(nowMs: number): number {
  return 60_000 - (nowMs % 60_000) + 50;
}

/** The start of the minute containing `ms`: the guide's "now". */
export function minuteOf(ms: number): number {
  return Math.floor(ms / 60_000) * 60_000;
}

/**
 * Calls onTick just after each minute, and again when the window comes back into
 * view (timers stall while the machine sleeps and are slowed while hidden).
 * Returns a stop function.
 */
export function startMinuteTicker(onTick: () => void): () => void {
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    timer = setTimeout(() => {
      onTick();
      schedule();
    }, msUntilNextMinute(Date.now()));
  };
  const resync = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    clearTimeout(timer);
    onTick();
    schedule();
  };
  schedule();
  if (typeof window !== 'undefined') {
    document.addEventListener('visibilitychange', resync);
    window.addEventListener('focus', resync);
  }
  return () => {
    clearTimeout(timer);
    if (typeof window !== 'undefined') {
      document.removeEventListener('visibilitychange', resync);
      window.removeEventListener('focus', resync);
    }
  };
}

// Floor to the current hour (local). By subtracting, not setMinutes: in the hour repeated when clocks go back,
// setMinutes resolves to the first pass and lands an hour early.
function floorToHour(date: Date): Date {
  return new Date(date.getTime() - (date.getMinutes() * 60 + date.getSeconds()) * 1000 - date.getMilliseconds());
}

/**
 * The guide's left edge while it follows now: the half hour now is in (8:00 or 8:30, local), so the show
 * on now usually starts at the edge with its whole title, and the grid moves twice an hour, not every
 * minute. Local minutes, not epoch maths: zones 30 or 45 minutes off UTC keep their own :00 and :30.
 */
export function floorToHalfHour(date: Date): Date {
  // Subtracting (not setMinutes, which lands an hour early in the hour repeated when clocks go back)
  return new Date(date.getTime() - ((date.getMinutes() % 30) * 60 + date.getSeconds()) * 1000 - date.getMilliseconds());
}

// One hour back: from between hours, snap to the hour; from an hour, the one before
export function stepBack(anchor: Date): Date {
  const hour = floorToHour(anchor);
  return hour.getTime() === anchor.getTime() ? addHours(hour, -1) : hour;
}

// Add hours to a date
function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

interface UseTimeGridOptions {
  // Available width for the program grid (excluding channel column)
  availableWidth: number;
  // Target pixels per hour (baseline for calculations)
  targetPixelsPerHour?: number;
  // Minimum visible hours
  minHours?: number;
  // Maximum visible hours
  maxHours?: number;
  // Hours to preload before visible window
  preloadBefore?: number;
  // Hours to preload after visible window
  preloadAfter?: number;
}

export function useTimeGrid({
  availableWidth,
  targetPixelsPerHour = 200,
  minHours = 2,
  maxHours = 5,
  preloadBefore = 2,
  preloadAfter = 4,
}: UseTimeGridOptions): TimeGridState & TimeGridActions {
  const [now, setNow] = useState<Date>(() => getNow());
  // The left edge the user browsed to, or null while following "now". Deriving the
  // edge from `now` (rather than copying it in an effect) keeps the clock, the edge
  // and what is on now in one render.
  const [browseAnchor, setBrowseAnchor] = useState<Date | null>(null);
  const isAtNow = browseAnchor === null;
  const liveAnchor = useMemo(() => floorToHalfHour(now), [now]);
  const anchor = browseAnchor ?? liveAnchor;

  // One tick per minute, on the minute: the clock and what is on now change together, when the shows do, and the
  // left edge with them when a half hour starts.
  const refreshNow = useCallback(() => {
    const minute = minuteOf(Date.now());
    setNow((current) => (current.getTime() === minute ? current : new Date(minute)));
  }, []);
  useEffect(() => startMinuteTicker(refreshNow), [refreshNow]);

  // Calculate visible hours and pixels per hour based on available width
  const { visibleHours, pixelsPerHour } = useMemo(() => {
    if (availableWidth <= 0) {
      return { visibleHours: minHours, pixelsPerHour: targetPixelsPerHour };
    }

    const idealHours = availableWidth / targetPixelsPerHour;
    const hours = clamp(idealHours, minHours, maxHours);
    const pph = availableWidth / hours;

    return { visibleHours: hours, pixelsPerHour: pph };
  }, [availableWidth, targetPixelsPerHour, minHours, maxHours]);

  // Calculate window boundaries
  const windowStart = anchor;
  const windowEnd = useMemo(() => addHours(anchor, visibleHours), [anchor, visibleHours]);

  // Calculate preload boundaries (wider window for data fetching)
  const loadStart = useMemo(() => addHours(anchor, -preloadBefore), [anchor, preloadBefore]);
  const loadEnd = useMemo(() => addHours(anchor, visibleHours + preloadAfter), [anchor, visibleHours, preloadAfter]);

  // Navigation: go back one hour (from now's half hour: from :30 to its hour, from :00 to the hour before)
  const goBack = useCallback(() => {
    setBrowseAnchor((current) => stepBack(current ?? liveAnchor));
  }, [liveAnchor]);

  // Navigation: go forward one hour (snap to even hour)
  const goForward = useCallback(() => {
    setBrowseAnchor((current) => addHours(floorToHour(current ?? now), 1));
  }, [now]);

  // Navigation: return to current time
  const goToNow = useCallback(() => {
    setBrowseAnchor(null);
    refreshNow();
  }, [refreshNow]);

  const goTo = useCallback((date: Date) => setBrowseAnchor(date), []);

  return {
    now,
    anchor,
    isAtNow,
    visibleHours,
    pixelsPerHour,
    windowStart,
    windowEnd,
    loadStart,
    loadEnd,
    goBack,
    goForward,
    goToNow,
    goTo,
  };
}
