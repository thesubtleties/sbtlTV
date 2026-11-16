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
  private o: Required<GovernorOptions>;

  constructor(private now: () => number, opts: GovernorOptions) {
    this.o = { maxExtra: 3, busyPerMinute: 100, quietPerMinute: 50, quietMinutes: 10, ...opts };
    this.minute = Math.floor(now() / MINUTE);
    this.previousBits = this.o.base;
  }

  /** Close the minutes that have passed (at most an hour's worth: after that it's all quiet anyway). */
  private roll(): void {
    const current = Math.floor(this.now() / MINUTE);
    let steps = 0;
    while (this.minute < current && steps++ < 60) {
      const n = this.count;
      this.count = 0;
      this.minute++;
      const before = this.extra;
      if (n > this.o.busyPerMinute) {
        this.extra = Math.min(this.o.maxExtra, this.extra + 1);
        this.quietRun = 0;
      } else if (n < this.o.quietPerMinute) {
        if (++this.quietRun >= this.o.quietMinutes && this.extra > 0) { this.extra--; this.quietRun = 0; }
      } else {
        this.quietRun = 0;
      }
      if (this.extra !== before) { this.previousBits = this.o.base + before; this.changedAt = this.minute * MINUTE; }
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

  proven(): void { this.roll(); this.count++; }
}
