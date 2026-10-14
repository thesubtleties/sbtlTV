/**
 * Feeds main's subtitle events into the subtitle store. Which load an update
 * belongs to, the defaults and any saved delay are bound by App when mpv-load
 * returns (useSubtitleStore.bindLoad); this hook only forwards.
 */
import { useEffect } from 'react';
import { useSubtitleStore } from '../stores/subtitleStore';
import { useUIStore } from '../stores/uiStore';

export function systemLocale(): string {
  return navigator.language || 'en';
}

export function subtitleDefaults(): { live: boolean; vod: boolean } {
  const s = useUIStore.getState().settings.subtitles;
  return { live: s?.liveDefault === true, vod: s?.vodDefault === true };
}

export function useSubtitleController(): void {
  useEffect(() => {
    if (!window.subtitles) return;
    const offTracks = window.subtitles.onTracks((update) => {
      const store = useSubtitleStore.getState();
      const defaults = subtitleDefaults();
      store.receiveTracks(update, store.kind ? defaults[store.kind] : false, systemLocale());
    });
    const offCc = window.subtitles.onCcState((update) => useSubtitleStore.getState().receiveCcState(update));
    return () => { offTracks(); offCc(); };
  }, []);
}
