import { HorizontalCarousel } from './HorizontalCarousel';
import { useMoviesByGenre, useSeriesByGenre } from '../../hooks/useTmdbLists';
import type { StoredMovie, StoredSeries } from '../../db';

type VodType = 'movie' | 'series';
type VodItem = StoredMovie | StoredSeries;

interface GenreCarouselProps {
  genreId: number;
  genreName: string;
  type: VodType;
  tmdbApiKey: string | null;
  onItemClick: (item: VodItem) => void;
}

export function GenreCarousel({
  genreId,
  genreName,
  type,
  tmdbApiKey,
  onItemClick,
}: GenreCarouselProps) {
  // Call the appropriate hook based on type
  const { movies, loading: moviesLoading } = useMoviesByGenre(
    type === 'movie' ? tmdbApiKey : null,
    type === 'movie' ? genreId : null
  );
  const { series, loading: seriesLoading } = useSeriesByGenre(
    type === 'series' ? tmdbApiKey : null,
    type === 'series' ? genreId : null
  );

  const items = type === 'movie' ? movies : series;
  const loading = type === 'movie' ? moviesLoading : seriesLoading;

  // Don't render if no items
  if (!loading && items.length === 0) {
    return null;
  }

  return (
    <HorizontalCarousel
      title={genreName}
      items={items}
      type={type}
      onItemClick={onItemClick}
      loading={loading}
    />
  );
}
