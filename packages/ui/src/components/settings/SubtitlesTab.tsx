import { useUIStore, useUpdateSettings } from '../../stores/uiStore';
import { useSubtitleStore } from '../../stores/subtitleStore';
import { systemLocale } from '../../hooks/useSubtitleController';
import type { SubtitleSettings } from '../../types/electron';
import { OnOff, OptionRow, Section, Segmented, SettingsTab } from './ui';
import { saveSettings } from '../../utils/saveSettings';

/** Captions and subtitles, on every platform: defaults per kind, language and look. */
export function SubtitlesTab() {
  const updateSettings = useUpdateSettings();
  const subtitles: SubtitleSettings = useUIStore((s) => s.settings.subtitles) ?? { liveDefault: false, vodDefault: false, size: 'medium', style: 'outline', language: 'auto' };

  async function updateSubtitles(patch: Partial<SubtitleSettings>) {
    const next = { ...subtitles, ...patch };
    updateSettings({ subtitles: next });
    // A new language applies to what is playing now: a movie's subtitles switch
    // track here; main re-checks live captions for the new language.
    if (patch.language !== undefined) useSubtitleStore.getState().repickVodTrack(systemLocale());
    await saveSettings({ subtitles: next });
  }

  return (
    <SettingsTab>
      <Section
        title="Subtitles"
        description="Captions on live TV and subtitles on movies and series, where the stream has them. The CC button in the player bar (or V) turns them on or off until you quit sbtlTV; right-click it for tracks and timing."
      >
        <OptionRow title="Live captions" help={subtitles.liveDefault ? 'Captions start on for every channel that carries them.' : 'Channels start without captions.'}>
          <OnOff value={subtitles.liveDefault} onChange={(v) => void updateSubtitles({ liveDefault: v })} />
        </OptionRow>
        <OptionRow title="Movie & series subtitles" help={subtitles.vodDefault ? 'Subtitles start on, in your system language when the file has it.' : 'Movies and episodes start without subtitles.'}>
          <OnOff value={subtitles.vodDefault} onChange={(v) => void updateSubtitles({ vodDefault: v })} />
        </OptionRow>
        <OptionRow
          title="Language"
          help={subtitles.language === 'auto'
            ? 'Your system language. Live captions prefer it when a channel carries several; if a channel only has another language, that one shows.'
            : 'Live captions prefer this language when a channel carries several; movie and series subtitles pick it when the file has it.'}
        >
          <Segmented
            value={subtitles.language}
            options={[{ id: 'auto', label: 'Auto' }, { id: 'en', label: 'English' }, { id: 'es', label: 'Español' }, { id: 'fr', label: 'Français' }]}
            onChange={(language) => void updateSubtitles({ language })}
          />
        </OptionRow>
        <OptionRow title="Size">
          <Segmented
            value={subtitles.size}
            options={[{ id: 'small', label: 'Small' }, { id: 'medium', label: 'Medium' }, { id: 'large', label: 'Large' }]}
            onChange={(size) => void updateSubtitles({ size })}
          />
        </OptionRow>
        <OptionRow
          title="Style"
          help={subtitles.style === 'box' ? 'Text on a dark box, like TV captions.' : subtitles.style === 'shadow' ? 'Text with a soft drop shadow.' : 'Text with a dark outline.'}
        >
          <Segmented
            value={subtitles.style}
            options={[{ id: 'outline', label: 'Outline' }, { id: 'box', label: 'Box' }, { id: 'shadow', label: 'Shadow' }]}
            onChange={(style) => void updateSubtitles({ style })}
          />
        </OptionRow>
      </Section>
    </SettingsTab>
  );
}
