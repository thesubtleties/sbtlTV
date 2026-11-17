// packages/ui/src/components/MissingFavorites.tsx
/** Synced favorite channels this computer doesn't have: grayed at the end of the Guide's Favorites (Settings › Sync & transfer). */
import type { StoredFavorite } from '../db';
import './MissingFavorites.css';

export { waitingFavorites } from '../services/sync/favorites';

export function MissingFavoriteRows({ rows, onRemove }: { rows: StoredFavorite[]; onRemove: (row: StoredFavorite) => void }) {
  if (!rows.length) return null;
  return (
    <div className="missing-favorites" role="list" aria-label="Favorites not on this computer">
      {rows.map((f) => (
        <div key={f.id} className="missing-favorites__row" role="listitem">
          <span className="missing-favorites__name">{f.name}</span>
          <span className="missing-favorites__note">Not on this computer</span>
          <button type="button" className="st-btn st-btn--small" onClick={() => onRemove(f)}>Remove</button>
        </div>
      ))}
    </div>
  );
}
