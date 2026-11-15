/**
 * The "More like this" row for a detail page (TMDB key only). Asks TMDB for recommendations, and for
 * similar titles too when the row would have fewer than MORE_LIKE_THIS_ENOUGH (utils/moreLikeThis).
 * The requests go through services/tmdbDetails, so a hover prefetch may already have them.
 *
 * `pending` = an answer may still come (the series page keeps its tab bar's room meanwhile).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { isAdultCategoryName } from '@sbtltv/core';
import { tmdbRelated } from '../services/tmdbDetails';
import { useDedupedMovies, useDedupedSeries } from './useVodDedup';
import { useGroupedVodCategories } from './useVodCategories';
import { useMoviesByTmdbIdsQuery, useSeriesByTmdbIdsQuery } from './useTmdbLists';
import { pickMoreLikeThis, relatedLibraryReady, shouldAskSimilar } from '../utils/moreLikeThis';
import { adultCategoryIdsOf } from '../utils/tmdbLibrary';
import type { MediaItem } from '../types/media';
import type { StoredMovie, StoredSeries } from '../db';

interface Related { key: string; ids: number[]; failed: boolean }
const NONE: number[] = [];
const NO_ITEMS: MediaItem[] = [];
const NO_MOVIES: StoredMovie[] = [];
const NO_SERIES: StoredSeries[] = [];

function useRelated(apiKey: string | null | undefined, type: 'movie' | 'series', tmdbId: number | undefined, which: 'recommendations' | 'similar', ask: boolean, key: string): Related | null {
  const [state, setState] = useState<Related | null>(null);
  useEffect(() => {
    if (!ask || !apiKey || !tmdbId) return;
    let alive = true;
    tmdbRelated(apiKey, type, tmdbId, which)
      .then((ids) => { if (alive) setState({ key, ids, failed: false }); })
      .catch(() => { if (alive) setState({ key, ids: [], failed: true }); }); // bad key: tmdbKeyHealth reports it
    return () => { alive = false; };
  }, [apiKey, type, tmdbId, which, ask, key]);
  return state?.key === key ? state : null;
}

export function useMoreLikeThis(type: 'movie' | 'series', tmdbId: number | undefined, apiKey: string | null | undefined): { items: MediaItem[]; pending: boolean } {
  const key = `${type}:${tmdbId ?? ''}:${apiKey ? 1 : 0}`;
  const enabled = !!(apiKey && tmdbId);
  const { groupedCategories, ready } = useGroupedVodCategories(type);
  const adultCategoryIds = useMemo(() => adultCategoryIdsOf(groupedCategories, ready, isAdultCategoryName), [groupedCategories, ready]);

  const recs = useRelated(apiKey, type, tmdbId, 'recommendations', true, key);
  const [askSimilar, setAskSimilar] = useState<string | null>(null);
  const similarAsked = askSimilar === key;
  const similar = useRelated(apiKey, type, tmdbId, 'similar', similarAsked, key);
  const allIds = useMemo(() => [...(recs?.ids ?? NONE), ...(similar?.ids ?? NONE)], [recs, similar]);

  // Every library copy of these ids (one query, for this page's type only)
  const lookup = allIds.length ? allIds : null;
  const movies = useMoviesByTmdbIdsQuery(type === 'movie' ? lookup : null);
  const series = useSeriesByTmdbIdsQuery(type === 'series' ? lookup : null);
  const { data: rows, stale } = type === 'movie' ? movies : series;
  // The preferred source's copy of each title first (that one is shown), then every copy so the adult check sees them all
  const dedupedMovies = useDedupedMovies(type === 'movie' && lookup ? movies.data ?? NO_MOVIES : NO_MOVIES);
  const dedupedSeries = useDedupedSeries(type === 'series' && lookup ? series.data ?? NO_SERIES : NO_SERIES);
  const library: MediaItem[] = useMemo(() => {
    if (!lookup || !rows) return NO_ITEMS;
    const preferred = (type === 'movie' ? dedupedMovies : dedupedSeries).map((d) => d.item);
    return [...preferred, ...rows];
  }, [lookup, rows, type, dedupedMovies, dedupedSeries]);
  const libraryReady = relatedLibraryReady(allIds.length, rows, stale);

  const wantSimilar = useMemo(
    () => shouldAskSimilar({ recs, similarAsked, library: libraryReady ? library : null, adultCategoryIds, selfTmdbId: tmdbId }),
    [recs, similarAsked, libraryReady, library, adultCategoryIds, tmdbId],
  );
  useEffect(() => { if (wantSimilar) setAskSimilar(key); }, [wantSimilar, key]);

  const picked = useMemo(
    () => (enabled && libraryReady ? pickMoreLikeThis(allIds, library, adultCategoryIds, tmdbId) : null),
    [enabled, libraryReady, allIds, library, adultCategoryIds, tmdbId],
  );
  // While the bigger answer (with similar titles) loads, keep showing the row already picked for this title
  const lastPicked = useRef<{ key: string; items: MediaItem[] } | null>(null);
  if (picked) lastPicked.current = { key, items: picked };
  const items = picked ?? (lastPicked.current?.key === key ? lastPicked.current.items : NO_ITEMS);

  const settled = !enabled || recs?.failed === true || (recs !== null && libraryReady && adultCategoryIds !== null && !wantSimilar && (!similarAsked || similar !== null));
  return { items: enabled ? items : NO_ITEMS, pending: !settled };
}
