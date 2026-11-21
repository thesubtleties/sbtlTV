import { MediaCard } from './MediaCard';
import type { ContinueItem } from '../../hooks/useContinueWatching';
import type { MissingTitle } from '../../services/sync/missing';
import { MissingCard } from './MissingCard';
import { CarouselNav, useRowScroll } from './useRowScroll';
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
// home row renders, so Virtuoso's fixedItemHeight={394} slot stays consistent), and the same ‹ ›
// buttons, edge fades and arrow keys (a mouse wheel can't scroll a row sideways).
export function ContinueWatchingRow({ items, onPlay, onRemove, missing = [], onRemoveMissing }: Props) {
  const count = items.length + (onRemoveMissing ? missing.length : 0);
  const { scrollerRef, canScrollLeft, canScrollRight, scroll, handleKeyDown } = useRowScroll(count);
  if (items.length === 0 && missing.length === 0) return null;
  return (
    <section className="carousel" onKeyDown={handleKeyDown}>
      <div className="carousel__header">
        <h2 className="carousel__title">Continue Watching</h2>
        <CarouselNav canScrollLeft={canScrollLeft} canScrollRight={canScrollRight} scroll={scroll} />
      </div>
      <div className="carousel__scroll-container" ref={scrollerRef}>
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
      {canScrollLeft && <div className="carousel__fade carousel__fade--left" />}
      {canScrollRight && <div className="carousel__fade carousel__fade--right" />}
    </section>
  );
}
