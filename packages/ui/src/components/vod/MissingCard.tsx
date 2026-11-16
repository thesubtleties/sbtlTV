import { useTmdbPoster } from '../../hooks/useTmdbPoster';
import type { MissingTitle } from '../../services/sync/missing';
import './MediaCard.css';
import './MissingCard.css';

/**
 * A title from the user's lists that this computer's library doesn't have (usually synced from
 * another computer): grayed, not playable, removable. The TMDB poster when this computer has a
 * TMDB key, else the title on a plain card.
 */
export function MissingCard({ item, onRemove }: { item: MissingTitle; onRemove: (item: MissingTitle) => void }) {
  const poster = useTmdbPoster(item.type, item.tmdbId);
  return (
    <div className="media-card media-card--medium missing-card" role="group" aria-label={`${item.name}, not on this computer`} tabIndex={0}>
      <div className="media-card__poster missing-card__poster">
        {poster
          ? <img className="loaded" src={poster} alt="" loading="lazy" />
          : <div className="missing-card__title-only">{item.name}</div>}
        <button
          className="media-card__remove"
          onClick={() => onRemove(item)}
          aria-label={`Remove ${item.name}`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7l16 0" />
            <path d="M10 11l0 6" />
            <path d="M14 11l0 6" />
            <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12" />
          </svg>
        </button>
      </div>
      <div className="missing-card__info">
        <div className="missing-card__name">{item.name}</div>
        <div className="missing-card__note">Not on this computer</div>
      </div>
    </div>
  );
}

/** Watchlist titles this computer doesn't have, in their own short row after My Watchlist. */
export function MissingRow({ title, items, onRemove }: { title: string; items: MissingTitle[]; onRemove: (item: MissingTitle) => void }) {
  if (items.length === 0) return null;
  return (
    <section className="carousel">
      <div className="carousel__header">
        <h2 className="carousel__title">{title}</h2>
      </div>
      <div className="carousel__scroll-container">
        <div className="carousel__track">
          {items.map((m) => <MissingCard key={m.key} item={m} onRemove={onRemove} />)}
        </div>
      </div>
    </section>
  );
}
