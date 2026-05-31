import { MediaCard } from './MediaCard';
import type { ContinueItem } from '../../hooks/useContinueWatching';
import './HorizontalCarousel.css';

interface Props {
  items: ContinueItem[];
  onPlay: (item: ContinueItem) => void;
  onRemove: (item: ContinueItem) => void;
}

// Reuses the REAL carousel BEM classes (.carousel is height:366px — the exact box every other
// home row renders, so Virtuoso's fixedItemHeight={386} slot stays consistent). Nav arrows/fades
// are omitted (native horizontal scroll); add later for full parity if desired.
export function ContinueWatchingRow({ items, onPlay, onRemove }: Props) {
  if (items.length === 0) return null;
  return (
    <section className="carousel">
      <div className="carousel__header">
        <h2 className="carousel__title">Continue Watching</h2>
      </div>
      <div className="carousel__scroll-container">
        <div className="carousel__track">
          {items.map((it) => (
            <MediaCard
              key={it.key}
              item={it.media}
              type={it.kind === 'movie' ? 'movie' : 'series'}
              progress={it.resumePct}
              resumeLabel={it.subtitle}
              onClick={() => onPlay(it)}
              onRemove={() => onRemove(it)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
