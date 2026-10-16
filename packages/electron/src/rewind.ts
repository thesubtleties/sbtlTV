// Rewind live TV: the stored size, the per-load mpv options, and reading mpv's
// cache state. No electron imports, so it runs under node:test.

export const GIB = 1024 ** 3;
export const REWIND_HALF_GIB = GIB / 2;

/**
 * The largest rewind size: a quarter of the installed RAM, in 0.5 GB steps. The OS
 * reports a little less than what is installed (an "8 GB" laptop says 7.6), so
 * round up to the next 2 GB first.
 */
export function rewindCapBytes(totalMemBytes: number): number {
  const installed = Math.ceil(totalMemBytes / (2 * GIB)) * 2 * GIB;
  return Math.floor(installed / 4 / REWIND_HALF_GIB) * REWIND_HALF_GIB;
}

/** Stored rewind size in bytes, 0 = Off. On means 0.5 GB steps, at least 0.5 GB, never above the cap. */
export function normalizeRewindBytes(value: unknown, totalMemBytes: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  const cap = rewindCapBytes(totalMemBytes);
  if (cap <= 0) return 0;
  const stepped = Math.max(REWIND_HALF_GIB, Math.floor(value / REWIND_HALF_GIB) * REWIND_HALF_GIB);
  return Math.min(stepped, cap);
}

/** mpv's own cache defaults, for every load that does not rewind; the cache never goes to disk. */
export const MPV_DEFAULT_CACHE: Readonly<Record<string, string>> = {
  'demuxer-max-bytes': String(150 * 1024 ** 2),
  'demuxer-max-back-bytes': String(50 * 1024 ** 2),
  'demuxer-donate-buffer': 'yes',
  // External mpv reads the user's mpv.conf: never let it put a stream on disk.
  'cache-on-disk': 'no',
};

/**
 * mpv cache properties to set before a load (as properties, not loadfile options:
 * the 5-argument loadfile needs mpv 0.38, and Linux uses the system libmpv).
 *
 * Live with rewind: the whole size is the forward buffer and the back buffer
 * borrows what is unused (donate). At live, almost nothing is ahead, so the past
 * can fill it; paused, the waiting stream can fill it. Either way the total stays
 * at the size. mpv holds about twice its own count in real memory, so it gets half
 * the chosen size and the setting is close to real memory.
 */
export function rewindMpvProperties(bytes: number, live: boolean): Record<string, string> {
  if (!live || bytes <= 0) return { ...MPV_DEFAULT_CACHE };
  return {
    'demuxer-max-bytes': String(Math.floor(bytes / 2)),
    'demuxer-max-back-bytes': String(1024 ** 2),
    'demuxer-donate-buffer': 'yes',
    'cache-on-disk': 'no',
  };
}

export interface CacheRange {
  /** Oldest reachable stream time (s) */
  rangeStart: number;
  /** Newest reachable stream time (s): the live edge */
  liveEdge: number;
  /** What mpv holds in memory for this load */
  bufferedBytes: number;
  /** The part of it ahead of the playhead (fills while paused) */
  forwardBytes: number;
  /** The channel's rate (bytes/s): averaged over the cache once it holds 20 s, else mpv's instant input rate */
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
    if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    if (!best || end > best.end) best = { start, end };
  }
  if (!best) return null;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
  const bufferedBytes = num(state['total-bytes']);
  const span = best.end - best.start;
  // mpv's instant rate follows every network burst; the cache's own bytes per second is the channel's real rate.
  const bytesPerSecond = span >= 20 && bufferedBytes > 0 ? bufferedBytes / span : num(state['raw-input-rate']);
  return { rangeStart: best.start, liveEdge: best.end, bufferedBytes, forwardBytes: num(state['fw-bytes']), bytesPerSecond };
}

/**
 * A seek target inside the buffer. The oldest point moves on every second while
 * the buffer rolls, so stay 2 s inside it (at most half a tiny range).
 */
export function clampToRange(seconds: number, range: Pick<CacheRange, 'rangeStart' | 'liveEdge'>): number {
  if (!Number.isFinite(seconds)) return range.liveEdge;
  const margin = Math.min(2, (range.liveEdge - range.rangeStart) / 2);
  return Math.min(Math.max(seconds, range.rangeStart + margin), range.liveEdge);
}
