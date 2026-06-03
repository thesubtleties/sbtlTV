import type { Category } from '@sbtltv/core';

/**
 * Stamp each category with its provider arrival index (0-based).
 * Both adapters deliver categories in provider order — M3U by first-appearance
 * of group-title, Xtream by API array order — so the index IS the provider order.
 * Returns new objects; does not mutate inputs.
 */
export function assignCategoryPositions<T extends Category>(categories: T[]): T[] {
  return categories.map((c, i) => ({ ...c, position: i }));
}
