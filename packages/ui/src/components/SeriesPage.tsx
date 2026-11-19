import { VodPage } from './VodPage';
import type { VodPlayInfo } from '../types/media';

interface SeriesPageProps {
  onPlay?: (info: VodPlayInfo) => void;
  onPlayStart?: (info: VodPlayInfo) => void;
  onClose?: () => void;
}

export function SeriesPage({ onPlay, onPlayStart, onClose }: SeriesPageProps) {
  return <VodPage type="series" onPlay={onPlay} onPlayStart={onPlayStart} onClose={onClose} />;
}

export default SeriesPage;
