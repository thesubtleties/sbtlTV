import { useEffect, useState } from 'react';
import { GUIDE_SEARCH_MIN_CHARS, type GuideSearchResult } from '@sbtltv/core';
import { useDataQuery } from '../data/useDataQuery';
import { useEnabledSourceIds } from './useSourceFiltering';
import { useGuideSearchHideAdult } from '../stores/uiStore';
import { searchStatus } from '../utils/guideSearchLogic';

const DEBOUNCE_MS = 60;

export interface GuideSearchState {
  /** The latest results; they stay up while the next arrive. Null when not searching. */
  results: GuideSearchResult | null;
  /** The results on screen aren't for what's typed yet: nothing may act on them. */
  pending: boolean;
  failed: boolean;
}

/** `minute` is the guide's clock: results refresh with it, so shows that end drop out. */
export function useGuideSearch(query: string, enabled: boolean, minute: number): GuideSearchState {
  const [settled, setSettled] = useState('');
  const text = enabled ? query.trim() : '';
  useEffect(() => {
    const timer = setTimeout(() => setSettled(text), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  const sourceIds = useEnabledSourceIds();
  const hideAdult = useGuideSearchHideAdult();
  const active = settled.length >= GUIDE_SEARCH_MIN_CHARS && text.length >= GUIDE_SEARCH_MIN_CHARS;
  const { data, loading, stale, error } = useDataQuery(
    active ? { type: 'guideSearch', query: settled, sourceIds, nowMs: minute, hideAdult } : null,
    ['epg_programs', 'epg_links', 'channels'],
    [active ? settled : '', sourceIds.join(','), hideAdult, minute],
  );
  return { results: active ? data ?? null : null, ...searchStatus({ text, settled, active, stale, loading, hasData: data !== undefined, error }) };
}
