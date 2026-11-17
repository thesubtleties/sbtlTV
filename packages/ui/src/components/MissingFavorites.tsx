// packages/ui/src/components/MissingFavorites.tsx
/** Synced favorite channels this computer doesn't have: grayed at the end of the Guide's Favorites (Settings › Sync & transfer). */
import { useRef } from 'react';
import type { StoredFavorite } from '../db';
import './MissingFavorites.css';

export { waitingFavorites } from '../services/sync/favorites';

export interface MissingFavoritesContext { rows: StoredFavorite[]; onRemove: (row: StoredFavorite) => Promise<void> }

export function MissingFavoriteRows({ rows, onRemove }: { rows: StoredFavorite[]; onRemove: (row: StoredFavorite) => void | Promise<void> }) {
  const list = useRef<HTMLDivElement>(null);
  if (!rows.length) return null;
  const remove = async (row: StoredFavorite, index: number) => {
    await onRemove(row);
    // Keyboard focus moves to the next row's Remove (else the one before), not to the page
    requestAnimationFrame(() => {
      const buttons = list.current?.querySelectorAll<HTMLButtonElement>('.missing-favorites__remove');
      if (buttons?.length) buttons[Math.min(index, buttons.length - 1)].focus();
    });
  };
  return (
    <div className="missing-favorites" role="list" aria-label="Favorites not on this computer" ref={list}>
      {rows.map((f, i) => (
        <div key={f.id} className="missing-favorites__row" role="listitem">
          <span className="missing-favorites__name">{f.name}</span>
          <span className="missing-favorites__note">Not on this computer</span>
          <button
            type="button"
            className="st-btn st-btn--small missing-favorites__remove"
            aria-label={`Remove ${f.name ?? 'channel'} from favorites`}
            title="Removes it on your other computers too"
            onClick={() => void remove(f, i)}
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

/** The Guide's list footer (react-virtuoso): defined once, fed through the list's context. */
export function GuideMissingFavorites({ context }: { context?: MissingFavoritesContext }) {
  if (!context?.rows.length) return null;
  return <MissingFavoriteRows rows={context.rows} onRemove={context.onRemove} />;
}
