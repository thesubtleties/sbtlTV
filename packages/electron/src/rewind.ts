// Rewind live TV: the stored size, the per-load mpv options, and reading mpv's
// cache state. No electron imports, so it runs under node:test.

export const GIB = 1024 ** 3;
export const REWIND_HALF_GIB = GIB / 2;

/** The largest rewind size: a quarter of the computer's RAM, in 0.5 GB steps. */
export function rewindCapBytes(totalMemBytes: number): number {
  return Math.floor(totalMemBytes / 4 / REWIND_HALF_GIB) * REWIND_HALF_GIB;
}

/** Stored rewind size in bytes, 0 = Off. On means 0.5 GB steps, at least 0.5 GB, never above the cap. */
export function normalizeRewindBytes(value: unknown, totalMemBytes: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  const cap = rewindCapBytes(totalMemBytes);
  if (cap <= 0) return 0;
  const stepped = Math.max(REWIND_HALF_GIB, Math.floor(value / REWIND_HALF_GIB) * REWIND_HALF_GIB);
  return Math.min(stepped, cap);
}

/**
 * Options for one loadfile: only live loads with rewind on get a back buffer.
 * donate-buffer=no makes the limit real (by default the back buffer borrows the
 * unused read-ahead); demuxer-max-bytes stays at mpv's default (smaller starves 4K).
 */
export function rewindLoadOptions(bytes: number, live: boolean): string {
  if (!live || bytes <= 0) return '';
  return `demuxer-max-back-bytes=${bytes},demuxer-donate-buffer=no`;
}

export interface CacheRange {
  /** Oldest reachable stream time (s) */
  rangeStart: number;
  /** Newest reachable stream time (s): the live edge */
  liveEdge: number;
  /** What mpv holds in memory for this load */
  bufferedBytes: number;
  /** mpv's measured input rate (bytes/s) */
  bytesPerSecond: number;
}

/** mpv's demuxer-cache-state (an object over JSON IPC, a JSON string from the native addon) → the reachable range, or null. */
export function parseCacheState(raw: unknown): CacheRange | null {
  let v: unknown = raw;
  if (typeof v === 'string') {
    if (!v) return null;
    try { v = JSON.parse(v); } catch { return null; }
  }
  if (!v || typeof v !== 'object') return null;
  const state = v as Record<string, unknown>;
  const ranges = Array.isArray(state['seekable-ranges']) ? state['seekable-ranges'] as unknown[] : [];
  let best: { start: number; end: number } | null = null;
  for (const r of ranges) {
    const start = (r as Record<string, unknown> | null)?.start;
    const end = (r as Record<string, unknown> | null)?.end;
    if (typeof start !== 'number' || typeof end !== 'number' || end < start) continue;
    if (!best || end > best.end) best = { start, end };
  }
  if (!best) return null;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
  return { rangeStart: best.start, liveEdge: best.end, bufferedBytes: num(state['total-bytes']), bytesPerSecond: num(state['raw-input-rate']) };
}

/** A seek target inside the buffer. */
export function clampToRange(seconds: number, range: Pick<CacheRange, 'rangeStart' | 'liveEdge'>): number {
  return Math.min(Math.max(seconds, range.rangeStart), range.liveEdge);
}
