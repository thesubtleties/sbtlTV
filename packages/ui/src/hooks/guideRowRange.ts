// Row-index bookkeeping for the guide's program query. The guide only reads
// programs for the rows Virtuoso is rendering (plus a pad), so a 10k-channel
// list costs the same as a 50-channel one.

export interface RowRange {
  start: number; // inclusive
  end: number;   // inclusive
}

// Rows loaded on each side of the rendered range so the next wheel tick is
// usually already on screen.
export const GUIDE_ROW_PAD = 30;

// Debounce for scroll-driven range changes. A scrollbar drag fires dozens of
// changes and produces one query for wherever it settles.
export const GUIDE_RANGE_SETTLE_MS = 150;

export function padRowRange(range: RowRange, rowCount: number, pad: number): RowRange | null {
  if (rowCount <= 0) return null;
  return {
    start: Math.max(0, range.start - pad),
    end: Math.min(rowCount - 1, range.end + pad),
  };
}

export function rowRangeCovers(outer: RowRange | null, inner: RowRange): boolean {
  if (!outer) return false;
  return outer.start <= inner.start && inner.end <= outer.end;
}
