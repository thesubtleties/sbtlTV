import { useState, useEffect, useCallback, useMemo } from 'react';

export interface TimeGridState {
  // The current time, ticking on each minute (the clock, and what is on now)
  now: Date;
  // The left edge of the visible time window
  anchor: Date;
  // True when following the current time at the left edge
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
}

// Clamp a value between min and max
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// The current minute (the guide's "now", and the left edge at "now")
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

// Floor to the current hour
function floorToHour(date: Date): Date {
  const result = new Date(date);
  result.setMinutes(0, 0, 0);
  return result;
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
  const anchor = browseAnchor ?? now;

  // One tick per minute, on the minute: the clock, the left edge at "now" and
  // what is on now all change together, when the shows do.
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

  // Navigation: go back one hour (the first step back from "now" snaps to its hour)
  const goBack = useCallback(() => {
    setBrowseAnchor((current) => stepBack(current ?? now));
  }, [now]);

  // Navigation: go forward one hour (snap to even hour)
  const goForward = useCallback(() => {
    setBrowseAnchor((current) => addHours(floorToHour(current ?? now), 1));
  }, [now]);

  // Navigation: return to current time
  const goToNow = useCallback(() => {
    setBrowseAnchor(null);
    refreshNow();
  }, [refreshNow]);

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
  };
}
