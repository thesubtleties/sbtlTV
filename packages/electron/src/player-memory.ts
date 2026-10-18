// When to restart the player to give its memory back. No electron imports, so it runs under node:test.
//
// TEMPORARY until libmpv frees its packet pool: mpv 0.41 keeps the whole demuxer
// cache (packet data included) in a reuse pool after a stream ends and frees it
// only as later packets are created, so the main process holds it indefinitely
// (measured: 507 MB in use after stop -> 37 MB after destroying mpv). mpv master
// frees it earlier (54da0ba, 09900a0, unreleased as of 2026-10). Remove this, and
// the restart in main.ts (releasePlayerMemory), once the bundled/system libmpv has it.

/**
 * More than this cached during a stream (mpv's own count, demuxer-cache-state
 * total-bytes) is worth a player restart to return. mpv counts packet data only;
 * the memory it really holds was ~2.5x that (137 MB counted, 340 MB allocated).
 */
export const PLAYER_MEMORY_RELEASE_BYTES = 64 * 1024 ** 2;

export type PlayerMemoryEvent =
  | { peakBytes: number; event: 'stop' }
  | { peakBytes: number; event: 'load'; wasLive: boolean; nextLive: boolean };

/**
 * Release on stop, or when switching between live TV and movies/series. Channel
 * surfing and next episode keep the player: the next stream reuses the pool.
 */
export function shouldReleasePlayerMemory(e: PlayerMemoryEvent): boolean {
  if (e.peakBytes < PLAYER_MEMORY_RELEASE_BYTES) return false;
  return e.event === 'stop' || e.wasLive !== e.nextLive;
}

/**
 * What mpv's pool may be holding: the most any stream cached since the player
 * last started (the pool keeps the biggest, not only the last), and whether the
 * stream now loaded is live. main.ts feeds it and asks before each switch or stop.
 */
export class PlayerMemoryTracker {
  private highWaterBytes = 0;
  private currentLive: boolean | null = null;

  startStream(live: boolean): void {
    this.currentLive = live;
  }

  noteCached(bytes: number): void {
    if (Number.isFinite(bytes) && bytes > this.highWaterBytes) this.highWaterBytes = bytes;
  }

  shouldRelease(event: { event: 'stop' } | { event: 'load'; nextLive: boolean }): boolean {
    if (this.currentLive === null) return false;
    return event.event === 'stop'
      ? shouldReleasePlayerMemory({ peakBytes: this.highWaterBytes, event: 'stop' })
      : shouldReleasePlayerMemory({ peakBytes: this.highWaterBytes, event: 'load', wasLive: this.currentLive, nextLive: event.nextLive });
  }

  /** The player was restarted: its pool is gone. */
  released(): void {
    this.highWaterBytes = 0;
  }

  get peakBytes(): number {
    return this.highWaterBytes;
  }
}
