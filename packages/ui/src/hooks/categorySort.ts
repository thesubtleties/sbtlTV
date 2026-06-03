/** Minimal shape the comparator needs — `GroupedCategory` satisfies this. */
export interface CategorySortable {
  name: string;
  primaryPriority: number;  // source priority of the group's primary source (lower = higher priority)
  primaryPosition: number;  // provider position within that source (Infinity if unknown)
}

const UNKNOWN_SOURCE_PRIORITY = 999;

/**
 * Order a group's per-source entries by live-source priority (lower index in
 * `orderIndex` = higher priority; sources absent from the order sink to the end),
 * then report the resulting primary source's priority + position. Sorts `sources`
 * in place (the UI renders sub-items in this order) and returns the primary's keys.
 */
export function resolveGroupPrimary<T extends { sourceId: string; position: number }>(
  sources: T[],
  orderIndex: Map<string, number>,
): { primaryPriority: number; primaryPosition: number } {
  sources.sort(
    (a, b) =>
      (orderIndex.get(a.sourceId) ?? UNKNOWN_SOURCE_PRIORITY) -
      (orderIndex.get(b.sourceId) ?? UNKNOWN_SOURCE_PRIORITY),
  );
  const primary = sources[0];
  return {
    primaryPriority: orderIndex.get(primary.sourceId) ?? UNKNOWN_SOURCE_PRIORITY,
    primaryPosition: primary.position,
  };
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
