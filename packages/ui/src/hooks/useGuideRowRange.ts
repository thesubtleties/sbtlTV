import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { StoredChannel } from '../db';
import {
  padRowRange,
  rowRangeCovers,
  GUIDE_ROW_PAD,
  GUIDE_RANGE_SETTLE_MS,
  type RowRange,
} from './guideRowRange';

// Owns the row axis of the guide's program query the way useTimeGrid owns the
// time axis. Programs are read only for the rows Virtuoso is rendering, padded
// by GUIDE_ROW_PAD on each side. Scroll-driven range changes wait
// GUIDE_RANGE_SETTLE_MS so a scrollbar drag across thousands of rows reads
// once, where it stops; a settled range still inside the loaded range reads
// nothing. A new list (category switch, search, favorites) reads straight away.
export function useGuideRowRange(rows: StoredChannel[]) {
  const [renderedRange, setRenderedRange] = useState<RowRange | null>(null);
  const [loadedRange, setLoadedRange] = useState<RowRange | null>(null);
  // Source of truth for what is loaded; state mirrors it for rendering. Kept in
  // a ref so the commit effect can read it without depending on it.
  const loadedRangeRef = useRef<RowRange | null>(null);

  const handleRangeChange = useCallback((range: { startIndex: number; endIndex: number }) => {
    setRenderedRange({ start: range.startIndex, end: range.endIndex });
  }, []);

  // Declared before the commit effect so a list change is seen as "nothing
  // loaded" by the commit that runs in the same pass.
  useEffect(() => {
    loadedRangeRef.current = null;
  }, [rows]);

  useEffect(() => {
    if (!renderedRange) return;
    const commit = () => {
      if (rowRangeCovers(loadedRangeRef.current, renderedRange)) return;
      const next = padRowRange(renderedRange, rows.length, GUIDE_ROW_PAD);
      loadedRangeRef.current = next;
      setLoadedRange(next);
    };
    if (!loadedRangeRef.current) {
      commit();
      return;
    }
    const timer = setTimeout(commit, GUIDE_RANGE_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [renderedRange, rows]);

  const loadedStreamIds = useMemo(() => {
    if (!loadedRange) return [];
    return rows.slice(loadedRange.start, loadedRange.end + 1).map((ch) => ch.stream_id);
  }, [rows, loadedRange]);

  return { handleRangeChange, loadedStreamIds };
}
