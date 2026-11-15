/**
 * The "More like this" row for a detail page (TMDB key only). Asks TMDB for recommendations, and for
 * similar titles too when the row would have fewer than MORE_LIKE_THIS_ENOUGH (utils/moreLikeThis).
 * The requests go through services/tmdbDetails, so a hover prefetch may already have them.
 */
import { useEffect, useMemo, useState } from 'react';
import { isAdultCategoryName } from '@sbtltv/core';
import { tmdbRelated } from '../services/tmdbDetails';
import { useDataQuery } from '../data/useDataQuery';
import { useEnabledSourceIds } from './useSourceFiltering';
import { useDedupedMovies, useDedupedSeries } from './useVodDedup';
import { useGroupedVodCategories } from './useVodCategories';
import { pickMoreLikeThis, relatedLibraryReady, shouldAskSimilar } from '../utils/moreLikeThis';
import type { StoredMovie, StoredSeries } from '../db';

interface Related { key: string; ids: number[]; failed: boolean }
const NONE: number[] = [];
const NO_MOVIES: StoredMovie[] = [];
const NO_SERIES: StoredSeries[] = [];

function useRelated(apiKey: string | null | undefined, type: 'movie' | 'series', tmdbId: number | undefined, which: 'recommendations' | 'similar', ask: boolean, key: string): Related | null {
  const [state, setState] = useState<Related | null>(null);
  useEffect(() => {
    if (!ask || !apiKey || !tmdbId) return;
    let alive = true;
    tmdbRelated(apiKey, type, tmdbId, which)
      .then((ids) => { if (alive) setState({ key, ids, failed: false }); })
      .catch(() => { if (alive) setState({ key, ids: [], failed: true }); });
    return () => { alive = false; };
  }, [key, ask]); // eslint-disable-line react-hooks/exhaustive-deps
  return state?.key === key ? state : null;
}

export function useMoreLikeThis(type: 'movie' | 'series', tmdbId: number | undefined, apiKey: string | null | undefined) {
  const key = `${type}:${tmdbId ?? ''}:${apiKey ? 1 : 0}`;
  const enabledIds = useEnabledSourceIds();
  const { groupedCategories, ready } = useGroupedVodCategories(type);
  const adultCategoryIds = useMemo(
    () => (ready ? new Set(groupedCategories.filter((g) => isAdultCategoryName(g.name)).flatMap((g) => g.categoryIds)) : null),
    [groupedCategories, ready],
  );

  const recs = useRelated(apiKey, type, tmdbId, 'recommendations', true, key);
  const [askSimilar, setAskSimilar] = useState<string | null>(null);
  const similar = useRelated(apiKey, type, tmdbId, 'similar', askSimilar === key, key);
  const allIds = useMemo(() => [...(recs?.ids ?? NONE), ...(similar?.ids ?? NONE)], [recs, similar]);

  // The library rows for these ids; `stale` = still the answer for the previous ids
  const query = allIds.length ? { type: type === 'movie' ? 'movies' as const : 'series' as const, by: { kind: 'tmdbIds' as const, tmdbIds: allIds }, sourceIds: enabledIds } : null;
  const { data, stale } = useDataQuery(query, [type === 'movie' ? 'vod_movies' : 'vod_series'], [type, allIds.join(','), enabledIds.join(',')]);
  const rows = allIds.length ? data : [];
  // One copy per title, from the preferred source
  const dedupedMovies = useDedupedMovies(type === 'movie' && rows ? rows as StoredMovie[] : NO_MOVIES);
  const dedupedSeries = useDedupedSeries(type === 'series' && rows ? rows as StoredSeries[] : NO_SERIES);
  const library: (StoredMovie | StoredSeries)[] = useMemo(
    () => (type === 'movie' ? dedupedMovies : dedupedSeries).map((d) => d.item),
    [type, dedupedMovies, dedupedSeries],
  );
  const libraryReady = relatedLibraryReady(allIds.length, data, stale);

  useEffect(() => {
    if (shouldAskSimilar({ recs, similarAsked: askSimilar === key, library: libraryReady ? library : null, adultCategoryIds, selfTmdbId: tmdbId })) {
      setAskSimilar(key);
    }
  }, [recs, askSimilar, key, libraryReady, library, adultCategoryIds, tmdbId]);

  return useMemo(
    () => (apiKey && tmdbId && libraryReady ? pickMoreLikeThis(allIds, library, adultCategoryIds, tmdbId) : []),
    [apiKey, tmdbId, libraryReady, allIds, library, adultCategoryIds],
  );
}
