import { describe, it, expect } from 'vitest';
import { loadingBlocks, planMorph, resolveKind, decideLane, QUICK_RESOLVE_MS, type LaneInput } from './programLaneModel';

describe('loadingBlocks', () => {
  it('tiles the lane width with blocks that differ from row to row', () => {
    const a = loadingBlocks(0, 1000);
    const b = loadingBlocks(1, 1000);
    const sum = (blocks: { width: number }[]) => blocks.reduce((t, x) => t + x.width, 0);
    expect(a.length).toBe(4);
    expect(sum(a)).toBeCloseTo(1000, 6);
    expect(a.map((x) => x.width)).not.toEqual(b.map((x) => x.width));
  });

  it('is deterministic for a row', () => {
    expect(loadingBlocks(7, 800)).toEqual(loadingBlocks(7, 800));
  });

  it('gives every block its own period and a phase inside that period', () => {
    for (const block of loadingBlocks(3, 900)) {
      expect(block.durationMs).toBeGreaterThan(0);
      expect(block.phaseMs).toBeLessThanOrEqual(0);
      expect(-block.phaseMs).toBeLessThan(block.durationMs);
    }
  });
});

describe('resolveKind', () => {
  it('treats a row that resolved almost at once as quick', () => {
    expect(resolveKind(1000, 1000 + QUICK_RESOLVE_MS - 1)).toBe('quick');
  });

  it('morphs a row that sat loading for a while', () => {
    expect(resolveKind(1000, 1000 + QUICK_RESOLVE_MS)).toBe('morph');
  });
});

describe('planMorph', () => {
  // Four placeholders across a 1000px lane: 0-220, 220-560, 560-740, 740-1000
  const placeholders = [
    { left: 0, width: 220 },
    { left: 220, width: 340 },
    { left: 560, width: 180 },
    { left: 740, width: 260 },
  ];

  it('gives the on-air program the placeholder it overlaps most, even if an earlier show comes first', () => {
    const ended = { key: 'ended', left: 0, width: 50, onAir: false, ended: true };
    const onAir = { key: 'now', left: 50, width: 550, onAir: true, ended: false };
    const plan = planMorph(placeholders, [ended, onAir]);
    expect(plan.become.find((b) => b.program.key === 'now')?.placeholder).toBe(1);
    expect(plan.become.find((b) => b.program.key === 'ended')?.placeholder).toBe(0);
  });

  it('does not title a program that already ended until it lands', () => {
    const ended = { key: 'ended', left: 0, width: 50, onAir: false, ended: true };
    const onAir = { key: 'now', left: 50, width: 550, onAir: true, ended: false };
    const plan = planMorph(placeholders, [ended, onAir]);
    expect(plan.become.find((b) => b.program.key === 'ended')?.titled).toBe(false);
    expect(plan.become.find((b) => b.program.key === 'now')?.titled).toBe(true);
  });

  it('leaves placeholders nothing overlaps as spare', () => {
    const only = { key: 'a', left: 0, width: 200, onAir: true, ended: false };
    const plan = planMorph(placeholders, [only]);
    expect(plan.become).toEqual([{ placeholder: 0, program: only, titled: true }]);
    expect(plan.spare).toEqual([1, 2, 3]);
    expect(plan.extra).toEqual([]);
  });

  it('lists programs that overlap no free placeholder as extra instead of sliding them across the lane', () => {
    const programs = [
      { key: 'a', left: 0, width: 100, onAir: false, ended: true },
      { key: 'b', left: 100, width: 100, onAir: true, ended: false },
      { key: 'c', left: 200, width: 100, onAir: false, ended: false },
      { key: 'd', left: 300, width: 100, onAir: false, ended: false },
      { key: 'e', left: 400, width: 100, onAir: false, ended: false },
      { key: 'f', left: 500, width: 500, onAir: false, ended: false },
    ];
    const plan = planMorph(placeholders, programs);
    expect(plan.become.map((b) => [b.placeholder, b.program.key])).toEqual([[0, 'b'], [1, 'c'], [3, 'f']]);
    expect(plan.extra.map((p) => p.key)).toEqual(['a', 'd', 'e']);
    expect(plan.spare).toEqual([2]);
  });
});

describe('planMorph edge cases', () => {
  const placeholders = [
    { left: 0, width: 200 },
    { left: 200, width: 200 },
  ];

  it('breaks an overlap tie toward the earlier placeholder', () => {
    const program = { key: 'p', left: 100, width: 200, onAir: true, ended: false };
    expect(planMorph(placeholders, [program]).become[0].placeholder).toBe(0);
  });

  it('sends a zero-width program to extra rather than letting it claim a placeholder', () => {
    const program = { key: 'p', left: 50, width: 0, onAir: false, ended: true };
    const plan = planMorph(placeholders, [program]);
    expect(plan.become).toEqual([]);
    expect(plan.extra).toEqual([program]);
  });

  it('treats a program that only touches a placeholder edge as not overlapping it', () => {
    const program = { key: 'p', left: 200, width: 100, onAir: true, ended: false };
    expect(planMorph(placeholders, [program]).become[0].placeholder).toBe(1);
  });

  it('marks every placeholder spare when there are no programs', () => {
    expect(planMorph(placeholders, [])).toEqual({ become: [], spare: [0, 1], extra: [] });
  });

  it('marks every program extra when there are no placeholders', () => {
    const program = { key: 'p', left: 0, width: 100, onAir: true, ended: false };
    expect(planMorph([], [program])).toEqual({ become: [], spare: [], extra: [program] });
  });
});

describe('decideLane', () => {
  const base: LaneInput = {
    phase: 'loading',
    loadingSinceMs: 0,
    hadPrograms: false,
    programs: 'some',
    nowMs: 5000,
    reducedMotion: false,
    morphEnabled: true,
  };

  it('stays loading while programs are still unread', () => {
    expect(decideLane({ ...base, programs: 'unread' })).toBe('stay');
  });

  it('goes back to loading when programs disappear from a settled row', () => {
    expect(decideLane({ ...base, phase: 'ready', programs: 'unread' })).toBe('load');
  });

  it('morphs when the row waited, motion is allowed, and the setting is on', () => {
    expect(decideLane(base)).toBe('morph');
  });

  it('fades in when programs resolved quickly', () => {
    expect(decideLane({ ...base, nowMs: QUICK_RESOLVE_MS - 1 })).toBe('fade-in');
  });

  it('fades in instead of morphing when the setting is off', () => {
    expect(decideLane({ ...base, morphEnabled: false })).toBe('fade-in');
  });

  it('lands without animation under reduced motion', () => {
    expect(decideLane({ ...base, reducedMotion: true })).toBe('ready');
  });

  it('lands without animation when the channel has no EPG', () => {
    expect(decideLane({ ...base, programs: 'empty' })).toBe('ready');
  });

  it('fades in when a channel that had no EPG gets programs later', () => {
    expect(decideLane({ ...base, phase: 'ready', hadPrograms: false })).toBe('fade-in');
  });

  it('stays put when a settled row merely gets a different program set', () => {
    expect(decideLane({ ...base, phase: 'ready', hadPrograms: true })).toBe('stay');
  });

  it('fades to the new set when the programs change mid-morph', () => {
    expect(decideLane({ ...base, phase: 'morph', hadPrograms: true })).toBe('fade-in');
  });

  it('lands empty when the programs vanish mid-morph', () => {
    expect(decideLane({ ...base, phase: 'morph', hadPrograms: true, programs: 'empty' })).toBe('ready');
  });
});
