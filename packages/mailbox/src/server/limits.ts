/**
 * Abuse limits that never store an address: counters are keyed by HMAC(salt, ip) with a salt that
 * changes every hour and lives only in memory. Behind the cluster's ServiceLB every client may
 * share one address, so the per-sender limit is generous and proof-of-work is the real cost.
 */
import { createHmac, randomBytes } from 'node:crypto';

export class SenderLimiter {
  private salt = randomBytes(32);
  private hour = -1;
  private counts = new Map<string, number>();
  constructor(private now: () => number, private perHour: number) {}

  /** true = allowed. */
  hit(ip: string): boolean {
    const h = Math.floor(this.now() / 3_600_000);
    if (h !== this.hour) { this.hour = h; this.salt = randomBytes(32); this.counts.clear(); }
    const key = createHmac('sha256', this.salt).update(ip).digest('base64');
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    return n <= this.perHour;
  }
}

/** Proofs seen in the last few minutes, so one can't be replayed. */
export class SeenProofs {
  private seen = new Map<string, number>();
  constructor(private now: () => number) {}
  /** true = first use. */
  use(key: string): boolean {
    const t = this.now();
    for (const [k, exp] of this.seen) if (exp <= t) this.seen.delete(k);
    if (this.seen.has(key)) return false;
    this.seen.set(key, t + 5 * 60_000);
    return true;
  }
}
