import { HorizontalCarousel } from './HorizontalCarousel';
import type { MediaItem } from '../../types/media';
import './MoreLikeThis.css';

interface MoreLikeThisProps {
  type: 'movie' | 'series';
  items: MediaItem[]; // from useMoreLikeThis; empty = nothing rendered
  onSelect?: (item: MediaItem) => void;
  inTab?: boolean; // under a "More like this" tab: the tab is the heading
}

/** TMDB's recommendations for a title that the user's library has (see hooks/useMoreLikeThis). */
export function MoreLikeThis({ type, items, onSelect, inTab }: MoreLikeThisProps) {
  if (items.length === 0) return null;
  return (
    <section className={`more-like-this${inTab ? ' more-like-this--tab' : ''}`} aria-label="More like this">
      <HorizontalCarousel title="More like this" items={items} type={type} onItemClick={onSelect} />
    </section>
  );
}
