import { describe, it, expect } from 'vitest';
import { loadingBlocks, planMorph, resolveKind, QUICK_RESOLVE_MS } from './programLane';

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
  const programs = [
    { key: 'a', left: 0, width: 200 },
    { key: 'b', left: 200, width: 300 },
  ];

  it('gives each program a placeholder in order and marks the rest as spare', () => {
    const plan = planMorph(4, programs);
    expect(plan.become).toEqual([
      { placeholder: 0, program: programs[0] },
      { placeholder: 1, program: programs[1] },
    ]);
    expect(plan.spare).toEqual([2, 3]);
    expect(plan.extra).toEqual([]);
  });

  it('lists programs beyond the placeholder count as extra', () => {
    const many = [...programs, { key: 'c', left: 500, width: 100 }, { key: 'd', left: 600, width: 100 }, { key: 'e', left: 700, width: 100 }];
    const plan = planMorph(4, many);
    expect(plan.become.length).toBe(4);
    expect(plan.spare).toEqual([]);
    expect(plan.extra).toEqual([many[4]]);
  });
});
