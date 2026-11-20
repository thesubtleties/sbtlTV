import { MediaCard } from './MediaCard';
import type { ContinueItem } from '../../hooks/useContinueWatching';
import type { MissingTitle } from '../../services/sync/missing';
import { MissingCard } from './MissingCard';
import './HorizontalCarousel.css';

interface Props {
  items: ContinueItem[];
  onPlay: (item: ContinueItem) => void;
  onRemove: (item: ContinueItem) => void;
  /** Titles in progress this library doesn't have (synced from another computer): grayed after the rest */
  missing?: MissingTitle[];
  onRemoveMissing?: (item: MissingTitle) => void;
}

// Reuses the REAL carousel BEM classes (.carousel is height:374px — the exact box every other
// home row renders, so Virtuoso's fixedItemHeight={394} slot stays consistent). Nav arrows/fades
// are omitted (native horizontal scroll); add later for full parity if desired.
export function ContinueWatchingRow({ items, onPlay, onRemove, missing = [], onRemoveMissing }: Props) {
  if (items.length === 0 && missing.length === 0) return null;
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
          {onRemoveMissing && missing.map((m) => <MissingCard key={m.key} item={m} onRemove={onRemoveMissing} />)}
        </div>
      </div>
    </section>
  );
}
