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

  it('the 101st proven write in a minute raises it at once', () => {
    const { g } = make();
    for (let i = 0; i < 100; i++) g.proven();
    expect(g.bits()).toBe(20);
    g.proven();
    expect(g.bits()).toBe(21);
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
    expect(g.bits()).toBe(21);   // raised in minute 0, counted as busy (not raised twice)
    clock.go(9 * minute);
    expect(g.bits()).toBe(21);
    clock.go(minute);
    expect(g.bits()).toBe(20);
  });

  it('for a minute after a rise, proofs at the old level still count', () => {
    const { g, clock } = make();
    for (let i = 0; i < 101; i++) g.proven();
    expect(g.bits()).toBe(21);
    expect(g.accepted()).toBe(20);
    clock.go(minute);
    expect(g.accepted()).toBe(21);
  });


  it('a minute between quiet and busy starts the quiet count again', () => {
    const { g, clock } = make();
    for (let i = 0; i < 101; i++) g.proven();
    clock.go(minute);
    clock.go(8 * minute);                        // 9 quiet minutes so far (the busy one rolled at the first go)
    for (let i = 0; i < 60; i++) g.proven();     // neither busy nor quiet
    clock.go(minute);
    clock.go(2 * minute);                        // 2 quiet minutes: 11 counted without the reset
    expect(g.bits()).toBe(21);
    clock.go(8 * minute);
    expect(g.bits()).toBe(20);
  });

  it('a long idle spell brings it all the way down', () => {
    const { g, clock } = make();
    for (let m = 0; m < 3; m++) { for (let i = 0; i < 101; i++) g.proven(); clock.go(minute); }
    expect(g.bits()).toBe(23);
    clock.go(24 * 60 * minute);
    expect(g.bits()).toBe(20);
  });

  it('lowering the cap while running takes the level down to it', () => {
    let t = 0;
    let maxExtra = 3;
    const g = new PowGovernor(() => t, () => ({ base: 20, maxExtra }));
    for (let m = 0; m < 3; m++) { for (let i = 0; i < 101; i++) g.proven(); t += minute; }
    expect(g.bits()).toBe(23);
    maxExtra = 1;
    t += minute;
    expect(g.bits()).toBe(21);
  });

  it('a new base from the settings applies at once', () => {
    let base = 20;
    const g = new PowGovernor(() => 0, () => ({ base }));
    base = 24;
    expect(g.bits()).toBe(24);
    expect(g.accepted()).toBe(24);
  });
});

describe('size pricing', () => {
  it('a normal send costs the base; big ones much more', () => {
    expect(powBitsFor(20, 2 * 1024)).toBe(20);          // a real send (~1 KB)
    expect(powBitsFor(20, 64 * 1024)).toBe(20);
    expect(powBitsFor(20, 300 * 1024)).toBe(23);        // a big file playlist: ~8x
    expect(powBitsFor(20, 1024 * 1024)).toBe(24);       // 16x
    expect(powBitsFor(20, 2 * 1024 * 1024)).toBe(25);   // the largest send: 32x, about half a minute
  });
});
