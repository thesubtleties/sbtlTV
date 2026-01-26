import { VodPage } from './VodPage';

interface MoviesPageProps {
  onPlay?: (url: string, title: string) => void;
  onClose?: () => void;
}

export function MoviesPage({ onPlay, onClose }: MoviesPageProps) {
  return <VodPage type="movie" onPlay={onPlay} onClose={onClose} />;
}

export default MoviesPage;
