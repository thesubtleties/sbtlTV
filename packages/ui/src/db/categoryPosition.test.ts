import { describe, it, expect } from 'vitest';
import type { Category } from '@sbtltv/core';
import { assignCategoryPositions } from './categoryPosition';

function cat(id: string): Category {
  return { category_id: id, category_name: id, source_id: 's1' };
}

describe('assignCategoryPositions', () => {
  it('assigns 0-based position in array order', () => {
    const out = assignCategoryPositions([cat('a'), cat('b'), cat('c')]);
    expect(out.map((c) => c.position)).toEqual([0, 1, 2]);
  });

  it('does not mutate the input array items', () => {
    const input = [cat('a')];
    const out = assignCategoryPositions(input);
    expect(input[0].position).toBeUndefined();
    expect(out[0].position).toBe(0);
  });

  it('returns an empty array unchanged', () => {
    expect(assignCategoryPositions([])).toEqual([]);
  });
});
