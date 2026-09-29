/**
 * Presents video frames on a steady clock instead of on arrival.
 *
 * Frames reach the renderer unevenly on slower Linux machines: the median gap
 * is the frame interval, but one in twenty arrives 30-100ms late and the next
 * follows right behind it. Drawing on arrival turns that into a visible hitch
 * even though no frame is lost. The pacer keeps a small queue and releases one
 * frame per interval from the display refresh loop, so uneven arrival becomes
 * a constant delay of about (targetDepth - 1) frames. The default depth of 4
 * (about 120ms at 25 fps) absorbs the worst arrival gaps seen from a Kaby Lake
 * tester (145ms, i.e. a frame 105ms late); 3 left those as a visible stall.
 *
 * Latency is set by queue depth, not by elapsed time: a frame waits behind the
 * frames ahead of it, so a stall does not accumulate delay. After an underrun
 * the pacer re-primes to targetDepth before presenting again.
 */

export interface FramePacerOptions {
  /** Frames queued before presentation starts or restarts (default 4) */
  targetDepth?: number;
  /** Queue limit; the oldest frames beyond it are skipped (default 6) */
  maxDepth?: number;
  /** Starting estimate of the frame interval in ms (default 40, i.e. 25 fps) */
  initialIntervalMs?: number;
}

export class FramePacer<T> {
  readonly targetDepth: number;
  readonly maxDepth: number;
  /** Running estimate of the source frame interval, from arrival times */
  intervalMs: number;
  underruns = 0;
  skipped = 0;

  private queue: T[] = [];
  private nextDueAt: number | null = null;
  private lastArrivalAt: number | null = null;

  constructor(options: FramePacerOptions = {}) {
    this.targetDepth = Math.max(1, options.targetDepth ?? 4);
    this.maxDepth = Math.max(this.targetDepth, options.maxDepth ?? 6);
    this.intervalMs = options.initialIntervalMs ?? 40;
  }

  get depth(): number {
    return this.queue.length;
  }

  /**
   * Queue an arriving frame. Returns frames pushed out beyond maxDepth, which
   * the caller must release.
   */
  push(item: T, now: number): T[] {
    if (this.lastArrivalAt !== null) {
      // Late frames are followed by early ones, so clamp before averaging to
      // keep one stall from skewing the rate.
      const delta = now - this.lastArrivalAt;
      const clamped = Math.min(Math.max(delta, this.intervalMs * 0.5), this.intervalMs * 2);
      this.intervalMs += (clamped - this.intervalMs) * 0.05;
    }
    this.lastArrivalAt = now;
    this.queue.push(item);
    const evicted: T[] = [];
    while (this.queue.length > this.maxDepth) {
      evicted.push(this.queue.shift() as T);
      this.skipped++;
    }
    return evicted;
  }

  /** Remove the oldest queued frame (to reuse its resources); counts as a skip. */
  dropOldest(): T | undefined {
    const item = this.queue.shift();
    if (item !== undefined) this.skipped++;
    return item;
  }

  /**
   * Called once per display refresh. Returns the frame to show now, or null
   * to keep showing the current one.
   */
  tick(now: number, refreshMs: number): T | null {
    if (this.nextDueAt === null) {
      if (this.queue.length < this.targetDepth) return null;
      this.nextDueAt = now;
    }
    // Present on the refresh closest to the due time.
    if (now + refreshMs / 2 < this.nextDueAt) return null;

    const item = this.queue.shift();
    if (item === undefined) {
      this.underruns++;
      this.nextDueAt = null;
      return null;
    }

    let next = this.nextDueAt + this.intervalMs;
    // Above the steady depth (targetDepth - 1 after a present): present a little
    // faster until the extra frames drain, so a burst does not add lasting delay.
    if (this.queue.length > this.targetDepth - 1) next -= this.intervalMs * 0.25;
    // After a long refresh gap (hidden window, busy thread) do not try to
    // replay the missed schedule.
    if (next < now - this.intervalMs) next = now;
    this.nextDueAt = next;
    return item;
  }

  /** Drop everything (stream change, context loss). Returns queued frames to release. */
  reset(): T[] {
    const items = this.queue;
    this.queue = [];
    this.nextDueAt = null;
    this.lastArrivalAt = null;
    return items;
  }
}
