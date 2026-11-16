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
