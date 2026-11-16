import { describe, expect, it } from 'vitest';
import { PowGovernor } from '../src/server/governor';
import { powBitsFor } from '../src/protocol/pow';

describe('proof-of-work level under load', () => {
  const minute = 60_000;
  const make = () => { let t = 0; const clock = { now: () => t, go: (ms: number) => { t += ms; } }; return { clock, g: new PowGovernor(clock.now, { base: 20 }) }; };

  it('starts at the base level', () => {
    const { g } = make();
    expect(g.bits()).toBe(20);
  });

  it('a busy minute (over 100 proven writes) raises it one level, at most three', () => {
    const { g, clock } = make();
    for (let m = 0; m < 5; m++) {
      for (let i = 0; i < 101; i++) g.proven();
      clock.go(minute);
    }
    expect(g.bits()).toBe(23);
  });

  it('a normal minute does not raise it', () => {
    const { g, clock } = make();
    for (let i = 0; i < 100; i++) g.proven();
    clock.go(minute);
    expect(g.bits()).toBe(20);
  });

  it('ten quiet minutes bring it down one level', () => {
    const { g, clock } = make();
    for (let i = 0; i < 101; i++) g.proven();
    clock.go(minute);
    expect(g.bits()).toBe(21);
    clock.go(9 * minute);
    expect(g.bits()).toBe(21);
    clock.go(minute);
    expect(g.bits()).toBe(20);
  });

  it('for a minute after a rise, proofs at the old level still count', () => {
    const { g, clock } = make();
    for (let i = 0; i < 101; i++) g.proven();
    clock.go(minute);
    expect(g.bits()).toBe(21);
    expect(g.accepted()).toBe(20);
    clock.go(minute);
    expect(g.accepted()).toBe(21);
  });
});

describe('size pricing', () => {
  it('a normal send costs the base; big ones much more', () => {
    expect(powBitsFor(20, 2 * 1024)).toBe(20);          // a real send (~1 KB)
    expect(powBitsFor(20, 64 * 1024)).toBe(20);
    expect(powBitsFor(20, 300 * 1024)).toBe(23);        // a big file playlist: ~8x
    expect(powBitsFor(20, 1024 * 1024)).toBe(25);       // 4 + 1 above 512 KB
    expect(powBitsFor(20, 2 * 1024 * 1024)).toBe(27);   // 5 + 2: minutes, not seconds
  });
});
