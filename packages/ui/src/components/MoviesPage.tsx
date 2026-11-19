import { VodPage } from './VodPage';
import type { VodPlayInfo } from '../types/media';

interface MoviesPageProps {
  onPlay?: (info: VodPlayInfo) => void;
  onPlayStart?: (info: VodPlayInfo) => void;
  onClose?: () => void;
}

export function MoviesPage({ onPlay, onPlayStart, onClose }: MoviesPageProps) {
  return <VodPage type="movie" onPlay={onPlay} onPlayStart={onPlayStart} onClose={onClose} />;
}

export default MoviesPage;
