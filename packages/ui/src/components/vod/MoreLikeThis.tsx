import { HorizontalCarousel } from './HorizontalCarousel';
import { useMoreLikeThis } from '../../hooks/useMoreLikeThis';
import type { StoredMovie, StoredSeries } from '../../db';
import './MoreLikeThis.css';

interface MoreLikeThisProps {
  type: 'movie' | 'series';
  tmdbId: number | undefined;
  apiKey: string | null | undefined;
  onSelect?: (item: StoredMovie | StoredSeries) => void;
}

/** TMDB's recommendations for this title that the user's library has; nothing without a TMDB key or with too few. */
export function MoreLikeThis({ type, tmdbId, apiKey, onSelect }: MoreLikeThisProps) {
  const items = useMoreLikeThis(type, tmdbId, apiKey);
  if (items.length === 0) return null;
  return (
    <section className="more-like-this" aria-label="More like this">
      <HorizontalCarousel title="More like this" items={items} type={type} onItemClick={onSelect} />
    </section>
  );
}
