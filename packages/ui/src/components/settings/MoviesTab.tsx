import { useMovieGenres, useMultipleMoviesByGenre } from '../../hooks/useTmdbLists';
import { GenreCarouselTab } from './GenreCarouselTab';
import { SelectedListsSection } from './SelectedListsSection';

interface MoviesTabProps {
  tmdbApiKey: string | null;
  enabledGenres: number[] | undefined;
  onEnabledGenresChange: (genres: number[]) => void;
  settingsLoaded: boolean;
}

export function MoviesTab(props: MoviesTabProps) {
  return (
    <GenreCarouselTab
      {...props}
      before={<SelectedListsSection />}
      useGenres={useMovieGenres}
      useMultipleByGenre={useMultipleMoviesByGenre}
      settingsKey="movieGenresEnabled"
      title="Genre rows"
      description="Which genres get a row on the Movies home page."
    />
  );
}
