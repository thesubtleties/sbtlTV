import { useTvGenres, useMultipleSeriesByGenre } from '../../hooks/useTmdbLists';
import { GenreCarouselTab } from './GenreCarouselTab';
import { useUpdateSettings } from '../../stores/uiStore';

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
    <>
      <label className="genre-checkbox" style={{ maxWidth: '320px', marginTop: '16px' }}>
        <input
          type="checkbox"
          checked={autoplayNextEpisode}
          onChange={(e) => handleAutoplayChange(e.target.checked)}
        />
        Autoplay next episode
      </label>
      <GenreCarouselTab
        {...genreProps}
        useGenres={useTvGenres}
        useMultipleByGenre={useMultipleSeriesByGenre}
        settingsKey="seriesGenresEnabled"
        title="Series Genre Carousels"
        description="Select which genres to show as carousels on the Series home page. Each selected genre will appear as a Netflix-style row."
      />
    </>
  );
}
