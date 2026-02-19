import { useTvGenres, useMultipleSeriesByGenre } from '../../hooks/useTmdbLists';
import { GenreCarouselTab } from './GenreCarouselTab';

interface SeriesTabProps {
  tmdbApiKey: string | null;
  enabledGenres: number[] | undefined;
  onEnabledGenresChange: (genres: number[]) => void;
  settingsLoaded: boolean;
}

export function SeriesTab(props: SeriesTabProps) {
  return (
    <GenreCarouselTab
      {...props}
      useGenres={useTvGenres}
      useMultipleByGenre={useMultipleSeriesByGenre}
      settingsKey="seriesGenresEnabled"
      title="Series Genre Carousels"
      description="Select which genres to show as carousels on the Series home page. Each selected genre will appear as a Netflix-style row."
    />
  );
}
