/**
 * The proof-of-work level follows the load: a minute with more than `busyPerMinute` proven writes
 * raises it one level (twice the work), at most `maxExtra` above the base; `quietMinutes` quiet
 * minutes in a row (under `quietPerMinute`) bring it down one. For a minute after a rise, proofs
 * at the old level still count, so nobody mid-work gets refused. Only proven writes count, so junk
 * can't push the level up.
 */
const MINUTE = 60_000;

export interface GovernorOptions { base: number; maxExtra?: number; busyPerMinute?: number; quietPerMinute?: number; quietMinutes?: number }

export class PowGovernor {
  private extra = 0;
  private minute: number;
  private count = 0;
  private quietRun = 0;
  private previousBits: number;
  private changedAt = -Infinity;
  private raisedThisMinute = false;
  private opts: () => GovernorOptions;

  /** Options can be a getter: the knobs may change while running (settings.ts). */
  constructor(private now: () => number, opts: GovernorOptions | (() => GovernorOptions)) {
    this.opts = typeof opts === 'function' ? opts : () => opts;
    this.minute = Math.floor(now() / MINUTE);
    this.previousBits = this.o.base;
  }

  private get o(): Required<GovernorOptions> {
    return { maxExtra: 3, busyPerMinute: 100, quietPerMinute: 50, quietMinutes: 10, ...this.opts() };
  }

  /** Close the minutes that have passed (at most an hour's worth: after that it's all quiet anyway). */
  private roll(): void {
    const current = Math.floor(this.now() / MINUTE);
    let steps = 0;
    while (this.minute < current && steps++ < 60) {
      const n = this.count;
      const raised = this.raisedThisMinute;
      this.count = 0;
      this.raisedThisMinute = false;
      this.minute++;
      const before = this.extra;
      if (n > this.o.busyPerMinute) {
        if (!raised) this.extra = Math.min(this.o.maxExtra, this.extra + 1);   // raised already, mid-minute
        this.quietRun = 0;
      } else if (n < this.o.quietPerMinute) {
        if (++this.quietRun >= this.o.quietMinutes && this.extra > 0) { this.extra--; this.quietRun = 0; }
      } else {
        this.quietRun = 0;
      }
      if (this.extra !== before) { this.previousBits = this.o.base + before; this.changedAt = this.minute * MINUTE; }
      if (this.extra > this.o.maxExtra) this.extra = this.o.maxExtra;   // the cap was lowered
    }
    if (this.minute < current) this.minute = current;
  }

  /** What a new proof should have now. */
  bits(): number { this.roll(); return this.o.base + this.extra; }

  /** What the server accepts now: the old level for a minute after a change. */
  accepted(): number {
    const now = this.bits();
    return this.now() - this.changedAt < MINUTE ? Math.min(now, this.previousBits) : now;
  }

  /** Counts a proven write; the one that makes the minute busy raises the level right away. */
  proven(): void {
    this.roll();
    if (++this.count > this.o.busyPerMinute && !this.raisedThisMinute && this.extra < this.o.maxExtra) {
      this.raisedThisMinute = true;
      this.previousBits = this.o.base + this.extra;
      this.changedAt = this.now();
      this.extra++;
    }
  }
}
