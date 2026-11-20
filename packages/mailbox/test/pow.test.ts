import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { checkPow, powInput, solvePow, solvePowAsync } from '../src/protocol/pow';
import { versionAtLeast } from '../src/protocol/version';

describe('proof-of-work', () => {
  it('a solved nonce checks; it is bound to version, route, body and minute', () => {
    const input = powInput('/v1/knock', '{"commitment":"x"}', 'c1', '0.17.0');
    const nonce = solvePow(input, 12);
    expect(checkPow(input, nonce, 12)).toBe(true);
    expect(checkPow(powInput('/v1/ring', '{"commitment":"x"}', 'c1', '0.17.0'), nonce, 12)).toBe(false);
    expect(checkPow(powInput('/v1/knock', '{"commitment":"y"}', 'c1', '0.17.0'), nonce, 12)).toBe(false);
    expect(checkPow(powInput('/v1/knock', '{"commitment":"x"}', 'c2', '0.17.0'), nonce, 12)).toBe(false);
    expect(checkPow(powInput('/v1/knock', '{"commitment":"x"}', 'c1', '0.18.0'), nonce, 12)).toBe(false); // another version
  });
  it('two people solving the same input get different proofs (one is never a replay of the other)', () => {
    const input = powInput('/v1/ring', '{"code":"7KQ4M2XD"}', 'c1', '0.17.0');
    expect(solvePow(input, 4)).not.toBe(solvePow(input, 4));
  });
  it('the async solver lets other work run while it searches', async () => {
    const input = powInput('/v1/knock', '{}', 'c1', '0.17.0');
    // From 0, find where the first answer is, then search in slices half that long: at least one break
    let first = 0;
    while (!checkPow(input, String(first), 12)) first++;
    let ticked = false;
    setImmediate(() => { ticked = true; });
    const nonce = await solvePowAsync(input, 12, Math.max(1, Math.floor(first / 2)), 0);
    expect(nonce).toBe(String(first));
    expect(ticked).toBe(first > 1);
  });
  it('counts leading zero bits exactly: one bit short is refused', () => {
    const zeros = (input: string, nonce: string) => {
      const bin = [...createHash('sha256').update(input + nonce).digest()].map((b) => b.toString(2).padStart(8, '0')).join('');
      return bin.indexOf('1');
    };
    const input = powInput('/v1/knock', '{}', 'c1', '0.17.0');
    for (let n = 0, seen = new Set<number>(); seen.size < 6 && n < 100_000; n++) {
      const z = zeros(input, String(n));
      if (z < 1 || z > 10 || seen.has(z)) continue;
      seen.add(z);
      expect(checkPow(input, String(n), z)).toBe(true);
      expect(checkPow(input, String(n), z + 1)).toBe(false);
    }
  });
  it('rejects junk nonces', () => {
    expect(checkPow('a', 'not a number', 1)).toBe(false);
    expect(checkPow('a', '1'.repeat(40), 1)).toBe(false);
  });
});

describe('version gate', () => {
  it('compares numerically and ignores pre-release tags', () => {
    expect(versionAtLeast('0.17.0', '0.17.0')).toBe(true);
    expect(versionAtLeast('0.17.0-beta.1', '0.17.0')).toBe(true);
    expect(versionAtLeast('0.9.0', '0.17.0')).toBe(false);
    expect(versionAtLeast('1.0.0', '0.17.0')).toBe(true);
    expect(versionAtLeast('garbage', '0.17.0')).toBe(false);
  });
});
