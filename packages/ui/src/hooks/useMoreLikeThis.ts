/**
 * The "More like this" row for a detail page (TMDB key only). Asks TMDB for recommendations,
 * and for similar titles too when the library has fewer than MORE_LIKE_THIS_ENOUGH of them.
 * The requests go through services/tmdbDetails, so a hover prefetch may already have them.
 */
import { useEffect, useMemo, useState } from 'react';
import { isAdultCategoryName } from '@sbtltv/core';
import { tmdbRelated } from '../services/tmdbDetails';
import { useMoviesByTmdbIds, useSeriesByTmdbIds } from './useTmdbLists';
import { useDedupedMovies, useDedupedSeries } from './useVodDedup';
import { useGroupedVodCategories } from './useVodCategories';
import { pickMoreLikeThis, countInLibrary, MORE_LIKE_THIS_ENOUGH } from '../utils/moreLikeThis';
import type { StoredMovie, StoredSeries } from '../db';

const NONE: number[] = [];
const NO_MOVIES: StoredMovie[] = [];
const NO_SERIES: StoredSeries[] = [];

export function useMoreLikeThis(type: 'movie' | 'series', tmdbId: number | undefined, apiKey: string | null | undefined) {
  const [recs, setRecs] = useState<{ key: string; ids: number[] } | null>(null);
  const [similar, setSimilar] = useState<{ key: string; ids: number[] } | null>(null);
  const key = `${type}:${tmdbId ?? ''}:${apiKey ? 1 : 0}`;

  useEffect(() => {
    if (!apiKey || !tmdbId) return;
    let alive = true;
    tmdbRelated(apiKey, type, tmdbId, 'recommendations')
      .then((ids) => { if (alive) setRecs({ key, ids }); })
      .catch(() => { if (alive) setRecs({ key, ids: [] }); });
    return () => { alive = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const recIds = recs?.key === key ? recs.ids : NONE;
  const similarIds = similar?.key === key ? similar.ids : NONE;
  const allIds = useMemo(() => [...recIds, ...similarIds], [recIds, similarIds]);

  const movies = useMoviesByTmdbIds(type === 'movie' ? allIds : NONE);
  const series = useSeriesByTmdbIds(type === 'series' ? allIds : NONE);
  // One copy per title, from the preferred source
  const dedupedMovies = useDedupedMovies(movies ?? NO_MOVIES);
  const dedupedSeries = useDedupedSeries(series ?? NO_SERIES);
  const library: (StoredMovie | StoredSeries)[] = useMemo(
    () => (type === 'movie' ? dedupedMovies : dedupedSeries).map((d) => d.item),
    [type, dedupedMovies, dedupedSeries],
  );
  const libraryLoaded = (type === 'movie' ? movies : series) !== undefined;

  // Too few recommendations in the library: ask for similar titles too (once per title)
  useEffect(() => {
    if (!apiKey || !tmdbId || recs?.key !== key || similar?.key === key || !libraryLoaded) return;
    if (countInLibrary(recIds, library, tmdbId) >= MORE_LIKE_THIS_ENOUGH) return;
    let alive = true;
    tmdbRelated(apiKey, type, tmdbId, 'similar')
      .then((ids) => { if (alive) setSimilar({ key, ids }); })
      .catch(() => { if (alive) setSimilar({ key, ids: [] }); });
    return () => { alive = false; };
  }, [key, recs, libraryLoaded, library]); // eslint-disable-line react-hooks/exhaustive-deps

  const { groupedCategories, ready } = useGroupedVodCategories(type);
  const adultCategoryIds = useMemo(
    () => (ready ? new Set(groupedCategories.filter((g) => isAdultCategoryName(g.name)).flatMap((g) => g.categoryIds)) : null),
    [groupedCategories, ready],
  );

  return useMemo(
    () => (apiKey && tmdbId ? pickMoreLikeThis(allIds, library, adultCategoryIds, tmdbId) : []),
    [apiKey, tmdbId, allIds, library, adultCategoryIds],
  );
}
