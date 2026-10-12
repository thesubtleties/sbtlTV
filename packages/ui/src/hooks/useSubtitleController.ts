/**
 * Connects mpv's subtitle tracks to the subtitle store: a new load (new
 * generation from main) starts the stream with the session choice or the
 * setting's default; later updates of the same load (the live CC track shows
 * up with the decoder) refresh the list. For movies and episodes it restores
 * the delay saved with the watch progress once the duration is known.
 */
import { useEffect, useRef } from 'react';
import { useSubtitleStore } from '../stores/subtitleStore';
import { useUIStore } from '../stores/uiStore';
import { getSavedSubtitleDelay } from './useWatchProgress';
import type { SubtitleKind } from '../services/subtitleLogic';
import type { VodPlayInfo } from '../types/media';

export function systemLocale(): string {
  return navigator.language || 'en';
}

export function subtitleDefaults(): { live: boolean; vod: boolean } {
  const s = useUIStore.getState().settings.subtitles;
  return { live: s?.liveDefault === true, vod: s?.vodDefault === true };
}

export function useSubtitleController({ kind, vodInfo, duration }: {
  kind: SubtitleKind | null;
  vodInfo: VodPlayInfo | null;
  duration: number;
}): void {
  const kindRef = useRef(kind);
  kindRef.current = kind;
  const restoredForRef = useRef(-1);

  useEffect(() => {
    if (!window.subtitles) return;
    return window.subtitles.onTracks(({ generation, tracks }) => {
      const k = kindRef.current;
      if (!k) return;
      const defaults = subtitleDefaults();
      const store = useSubtitleStore.getState();
      // A new load, or the same load seen first under the previous kind (main sends an
      // empty list at load time, possibly before App switched live <-> vod).
      if (generation !== store.generation || k !== store.kind) store.startStream(k, generation, tracks, defaults[k], systemLocale());
      else store.updateTracks(tracks, defaults[k], systemLocale());
    });
  }, []);

  // Restore a saved delay once per VOD load, when the duration is known.
  const generation = useSubtitleStore((s) => s.generation);
  useEffect(() => {
    if (kind !== 'vod' || !vodInfo?.streamId || !(duration > 0)) return;
    if (restoredForRef.current === generation) return;
    restoredForRef.current = generation;
    const type = vodInfo.type === 'series' ? 'episode' : 'movie';
    void getSavedSubtitleDelay(type, {
      streamId: vodInfo.streamId,
      tmdbId: type === 'movie' ? vodInfo.tmdbId : undefined,
      seriesTmdbId: type === 'episode' ? vodInfo.tmdbId : undefined,
      seriesStreamId: vodInfo.seriesStreamId,
      sourceId: vodInfo.sourceId,
      seasonNum: vodInfo.seasonNum,
      episodeNum: vodInfo.episodeNum,
    }, duration).then((delay) => {
      if (delay !== 0 && useSubtitleStore.getState().generation === generation) {
        useSubtitleStore.getState().setDelay(delay);
      }
    });
  }, [kind, vodInfo, duration, generation]);
}
