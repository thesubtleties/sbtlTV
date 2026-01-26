import { VodPage } from './VodPage';

interface SeriesPageProps {
  onPlay?: (url: string, title: string) => void;
  onClose?: () => void;
}

export function SeriesPage({ onPlay, onClose }: SeriesPageProps) {
  return <VodPage type="series" onPlay={onPlay} onClose={onClose} />;
}

export default SeriesPage;
