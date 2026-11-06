import { useEffect, useState } from 'react';
import { GUIDE_SEARCH_MIN_CHARS, type GuideSearchResult } from '@sbtltv/core';
import { useDataQuery } from '../data/useDataQuery';
import { useEnabledSourceIds } from './useSourceFiltering';
import { useGuideSearchHideAdult } from '../stores/uiStore';

const DEBOUNCE_MS = 60;

/** Results for what's typed; the last ones stay up while the next arrive. Null when not searching. */
export function useGuideSearch(query: string, enabled: boolean): GuideSearchResult | null {
  const [settled, setSettled] = useState('');
  const text = enabled ? query.trim() : '';
  useEffect(() => {
    const timer = setTimeout(() => setSettled(text), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  const sourceIds = useEnabledSourceIds();
  const hideAdult = useGuideSearchHideAdult();
  const active = settled.length >= GUIDE_SEARCH_MIN_CHARS && text.length >= GUIDE_SEARCH_MIN_CHARS;
  const { data } = useDataQuery(
    active ? { type: 'guideSearch', query: settled, sourceIds, nowMs: Date.now(), hideAdult } : null,
    ['epg_programs', 'epg_links', 'channels'],
    [active ? settled : '', sourceIds.join(','), hideAdult],
  );
  return active ? data ?? null : null;
}
