import { useTvGenres, useMultipleSeriesByGenre } from '../../hooks/useTmdbLists';
import { GenreCarouselTab } from './GenreCarouselTab';
import { useUpdateSettings } from '../../stores/uiStore';
import { OnOff, OptionRow, Section } from './ui';

interface SeriesTabProps {
  tmdbApiKey: string | null;
  enabledGenres: number[] | undefined;
  onEnabledGenresChange: (genres: number[]) => void;
  settingsLoaded: boolean;
  autoplayNextEpisode: boolean;
  onAutoplayNextEpisodeChange: (v: boolean) => void;
}

export function SeriesTab({ autoplayNextEpisode, onAutoplayNextEpisodeChange, ...genreProps }: SeriesTabProps) {
  const updateSettings = useUpdateSettings();
  async function handleAutoplayChange(enabled: boolean) {
    onAutoplayNextEpisodeChange(enabled);
    updateSettings({ autoplayNextEpisode: enabled });
    if (window.storage) await window.storage.updateSettings({ autoplayNextEpisode: enabled });
  }
  return (
    <GenreCarouselTab
      {...genreProps}
      useGenres={useTvGenres}
      useMultipleByGenre={useMultipleSeriesByGenre}
      settingsKey="seriesGenresEnabled"
      title="Genre rows"
      description="Which genres get a row on the Series home page."
      before={
        <Section title="Playback">
          <OptionRow
            title="Next episode"
            help={autoplayNextEpisode
              ? 'When an episode ends, the next one starts after a short countdown.'
              : 'When an episode ends, playback stops.'}
          >
            <OnOff value={autoplayNextEpisode} offLabel="Stop" onLabel="Autoplay" onChange={(enabled) => void handleAutoplayChange(enabled)} />
          </OptionRow>
        </Section>
      }
    />
  );
}
