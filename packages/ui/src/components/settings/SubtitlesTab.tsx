import { useSubtitleSettings } from '../../hooks/useSubtitleSettings';
import { OnOff, OptionRow, Section, SettingsTab } from './ui';

/** Movie and series subtitles. Language and look are in Video Player; live captions in Live playback. */
export function SubtitlesTab() {
  const { subtitles, updateSubtitles } = useSubtitleSettings();
  return (
    <SettingsTab>
      <Section
        title="Subtitles"
        description="Subtitles on movies and series, where the file has them. The CC button in the player bar (or V) turns them on or off until you quit sbtlTV; right-click it for tracks and timing. Language and look are under Video Player."
      >
        <OptionRow title="Movie & series subtitles" help={subtitles.vodDefault ? 'Subtitles start on, in your chosen language when the file has it.' : 'Movies and episodes start without subtitles.'}>
          <OnOff value={subtitles.vodDefault} onChange={(v) => void updateSubtitles({ vodDefault: v })} />
        </OptionRow>
      </Section>
    </SettingsTab>
  );
}
