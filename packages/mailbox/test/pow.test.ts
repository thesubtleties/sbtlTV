import { describe, expect, it } from 'vitest';
import { checkPow, powInput, solvePow, solvePowAsync } from '../src/protocol/pow';
import { versionAtLeast } from '../src/protocol/version';

describe('proof-of-work', () => {
  it('a solved nonce checks; it is bound to version, route, body and minute', () => {
    const input = powInput('/v1/knock', '{"commitment":"x"}', 29_000_000, '0.17.0');
    const nonce = solvePow(input, 12);
    expect(checkPow(input, nonce, 12)).toBe(true);
    expect(checkPow(powInput('/v1/ring', '{"commitment":"x"}', 29_000_000, '0.17.0'), nonce, 12)).toBe(false);
    expect(checkPow(powInput('/v1/knock', '{"commitment":"y"}', 29_000_000, '0.17.0'), nonce, 12)).toBe(false);
    expect(checkPow(powInput('/v1/knock', '{"commitment":"x"}', 29_000_001, '0.17.0'), nonce, 12)).toBe(false);
    expect(checkPow(powInput('/v1/knock', '{"commitment":"x"}', 29_000_000, '0.18.0'), nonce, 12)).toBe(false); // another version
  });
  it('two people solving the same input get different proofs (one is never a replay of the other)', () => {
    const input = powInput('/v1/ring', '{"code":"7KQ4M2XD"}', 29_000_000, '0.17.0');
    expect(solvePow(input, 4)).not.toBe(solvePow(input, 4));
  });
  it('the async solver lets other work run while it searches', async () => {
    const input = powInput('/v1/knock', '{}', 1, '0.17.0');
    // From 0, find where the first answer is, then search in slices half that long: at least one break
    let first = 0;
    while (!checkPow(input, String(first), 12)) first++;
    let ticked = false;
    setImmediate(() => { ticked = true; });
    const nonce = await solvePowAsync(input, 12, Math.max(1, Math.floor(first / 2)), 0);
    expect(nonce).toBe(String(first));
    expect(ticked).toBe(first > 1);
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
