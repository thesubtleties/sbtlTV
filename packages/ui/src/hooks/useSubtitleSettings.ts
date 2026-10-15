import { useUIStore, useUpdateSettings } from '../stores/uiStore';
import { useSubtitleStore } from '../stores/subtitleStore';
import { systemLocale } from './useSubtitleController';
import { saveSettings } from '../utils/saveSettings';
import type { SubtitleSettings } from '../types/electron';

const DEFAULTS: SubtitleSettings = { liveDefault: false, vodDefault: false, size: 'medium', style: 'outline', language: 'auto' };

/** Caption/subtitle settings and their updater, shared by Live playback, Subtitles and Video Player. */
export function useSubtitleSettings() {
  const updateSettings = useUpdateSettings();
  const subtitles: SubtitleSettings = useUIStore((s) => s.settings.subtitles) ?? DEFAULTS;
  async function updateSubtitles(patch: Partial<SubtitleSettings>) {
    const next = { ...subtitles, ...patch };
    updateSettings({ subtitles: next });
    // A new language applies to what is playing now: a movie's subtitles switch
    // track here; main re-checks live captions for the new language.
    if (patch.language !== undefined) useSubtitleStore.getState().repickVodTrack(systemLocale());
    await saveSettings({ subtitles: next });
  }
  return { subtitles, updateSubtitles };
}
