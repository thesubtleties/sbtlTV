import { useMovieGenres, useMultipleMoviesByGenre } from '../../hooks/useTmdbLists';
import { GenreCarouselTab } from './GenreCarouselTab';

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
      useGenres={useMovieGenres}
      useMultipleByGenre={useMultipleMoviesByGenre}
      settingsKey="movieGenresEnabled"
      title="Movie Genre Carousels"
      description="Select which genres to show as carousels on the Movies home page. Each selected genre will appear as a Netflix-style row."
    />
  );
}
