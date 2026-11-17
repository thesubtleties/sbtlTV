/**
 * Proofs seen recently, so one can't be used twice. Kept in buckets by the minute their challenge
 * was issued and dropped whole once that challenge has run out: no scan per request.
 */
import { createHash } from 'node:crypto';
import { CHALLENGE_TTL_MS } from '../protocol/index.js';

export class SeenProofs {
  private buckets = new Map<number, Set<string>>();
  constructor(private now: () => number) {}

  /** true = first use. `issuedAt` = when the proof's challenge was issued. */
  use(key: string, issuedAt: number): boolean {
    const t = this.now();
    for (const minute of this.buckets.keys()) if (minute * 60_000 + CHALLENGE_TTL_MS + 60_000 <= t) this.buckets.delete(minute);
    const minute = Math.floor(issuedAt / 60_000);
    let set = this.buckets.get(minute);
    if (!set) { set = new Set(); this.buckets.set(minute, set); }
    const h = createHash('sha256').update(key).digest('base64');
    if (set.has(h)) return false;
    set.add(h);
    return true;
  }
}

const HOUR = 3_600_000;
const KEEP_HOURS = 7 * 24;

/**
 * Downloads of each version of a box (or of a computer's new key), so a group handed around can't
 * serve as a download link. Normal sync downloads each version about once per computer in the
 * group (the others, and its own maker once). Counts and the hour of the last download only, in
 * memory: nothing about who asked. Kept until the box changes, is deleted, or nobody downloaded it
 * for a week. A relay restart starts every count again.
 */
export class Downloads {
  private seen = new Map<string, { seq: number; n: number; hour: number }>();
  private lastSweep: number;
  constructor(private now: () => number) { this.lastSweep = now(); }

  /** Times this version was downloaded in full */
  count(key: string, seq: number): number {
    this.sweep();
    const e = this.seen.get(key);
    return e && e.seq === seq ? e.n : 0;
  }

  /** One full download. A late one of an older version leaves the newer count alone. */
  add(key: string, seq: number): void {
    this.sweep();
    const e = this.seen.get(key);
    if (e && e.seq > seq) return;
    this.seen.set(key, { seq, n: e && e.seq === seq ? e.n + 1 : 1, hour: Math.floor(this.now() / HOUR) });
  }

  /** The box was replaced or deleted: its next version starts from nothing */
  forget(key: string): void { this.seen.delete(key); }

  /** Every count under this prefix (a group: a new computer joined, and joining re-reads every box) */
  forgetAll(prefix: string): void { for (const k of this.seen.keys()) if (k.startsWith(prefix)) this.seen.delete(k); }

  get size(): number { return this.seen.size; }

  private sweep(): void {
    if (this.now() - this.lastSweep < HOUR) return;
    this.lastSweep = this.now();
    const oldest = Math.floor(this.now() / HOUR) - KEEP_HOURS;
    for (const [k, e] of this.seen) if (e.hour < oldest) this.seen.delete(k);
  }
}
