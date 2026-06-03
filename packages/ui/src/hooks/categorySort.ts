/** Minimal shape the comparator needs — `GroupedCategory` satisfies this. */
export interface CategorySortable {
  name: string;
  primaryPriority: number;  // source priority of the group's primary source (lower = higher priority)
  primaryPosition: number;  // provider position within that source (Infinity if unknown)
}

/**
 * Order category groups for the live strip.
 * - 'alphabetical': by display name (current behavior).
 * - 'provider': by (primaryPriority, primaryPosition), then name as a stable
 *   tiebreak — i.e. highest-priority source first, then that source's order;
 *   groups with no known position fall to the end, alphabetised among themselves.
 * Pure: returns a new array, never mutates the input.
 */
export function sortCategoryGroups<T extends CategorySortable>(
  groups: T[],
  mode: 'alphabetical' | 'provider',
): T[] {
  const copy = [...groups];
  if (mode === 'alphabetical') {
    return copy.sort((a, b) => a.name.localeCompare(b.name));
  }
  return copy.sort((a, b) => {
    if (a.primaryPriority !== b.primaryPriority) return a.primaryPriority - b.primaryPriority;
    if (a.primaryPosition !== b.primaryPosition) return a.primaryPosition - b.primaryPosition;
    return a.name.localeCompare(b.name);
  });
}
