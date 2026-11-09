/**
 * Wires a VOD card to the hover prefetch (services/hoverPrefetch.ts): pointer
 * enter / keyboard focus start the dwell, leave / blur / unmount cancel it.
 */
import { useCallback, useEffect, useRef } from 'react';
import { data } from '../data/client';
import { tmdbDetails, tmdbCredits } from '../services/tmdbDetails';
import { createHoverPrefetch, prefetchTargetFor, EPISODES_MAX_AGE_MS } from '../services/hoverPrefetch';
import { useTmdbApiKey } from '../stores/uiStore';
import { useRpdbSettings } from './useRpdbSettings';
import type { StoredMovie, StoredSeries } from '../db';

// A few recent preloads stay referenced so a collected Image cannot drop its request.
const recentImages: HTMLImageElement[] = [];

const hoverPrefetch = createHoverPrefetch({
  details: (apiKey, kind, tmdbId) => tmdbDetails(apiKey, kind, tmdbId),
  credits: (apiKey, kind, tmdbId) => tmdbCredits(apiKey, kind, tmdbId),
  episodes: (seriesId) => data.query({ type: 'syncEpisodes', seriesId, maxAgeMs: EPISODES_MAX_AGE_MS, prefetch: true }),
  preload: (url) => {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    recentImages.push(img);
    if (recentImages.length > 8) recentImages.shift();
  },
  now: () => Date.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (h) => window.clearTimeout(h as number),
});

export function useHoverPrefetch(item: StoredMovie | StoredSeries) {
  const apiKey = useTmdbApiKey();
  const { apiKey: rpdbApiKey, backdropsEnabled } = useRpdbSettings();
  const token = useRef<number | undefined>(undefined);

  const start = useCallback(() => {
    token.current = hoverPrefetch.enter(prefetchTargetFor(item, apiKey, { apiKey: rpdbApiKey, backdropsEnabled }));
  }, [item, apiKey, rpdbApiKey, backdropsEnabled]);

  const stop = useCallback(() => {
    hoverPrefetch.leave(token.current);
    token.current = undefined;
  }, []);

  // A card scrolled out of a virtualized row unmounts without a pointerleave.
  useEffect(() => () => hoverPrefetch.leave(token.current), []);

  return { onPointerEnter: start, onPointerLeave: stop, onFocus: start, onBlur: stop };
}
