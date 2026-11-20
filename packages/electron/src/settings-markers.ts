/** One-time markers kept per computer (never exported, sent, imported or synced). */
export type FirstRunMarker = 'offer-sync' | 'done';

/** 'offer-sync': a setup was just received from the walkthrough; offer to join its sync once. 'done': never show it again. */
export function normalizeFirstRun(v: unknown): FirstRunMarker | undefined {
  return v === 'done' || v === 'offer-sync' ? v : undefined;
}

/** The version whose What's new was last shown (or skipped) on this computer. */
export function normalizeSeenVersion(v: unknown): string | undefined {
  return typeof v === 'string' && v.length <= 40 && /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(v) ? v : undefined;
}
